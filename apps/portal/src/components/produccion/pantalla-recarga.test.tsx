import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as cargasLib from "@/lib/cargas";
import type { Rejilla } from "@/lib/cargas";
import * as sucursalesLib from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaRecarga } from "./pantalla-recarga";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/sucursales");
vi.mock("@/lib/cargas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cargas")>();
  return {
    ...real,
    obtenerRejilla: vi.fn(),
    crearCarga: vi.fn(),
    editarCarga: vi.fn(),
    eliminarCarga: vi.fn(),
  };
});

const obtenerRejilla = vi.mocked(cargasLib.obtenerRejilla);
const crearCarga = vi.mocked(cargasLib.crearCarga);
const editarCarga = vi.mocked(cargasLib.editarCarga);
const eliminarCarga = vi.mocked(cargasLib.eliminarCarga);
const listarSucursales = vi.mocked(sucursalesLib.listarSucursales);
const HOY = hoyEnTijuana();

const REJILLA: Rejilla = {
  fecha: HOY,
  sucursal: { id: "s-tj", codigo: "TJ", nombre: "Tijuana" },
  presentaciones: [
    { id: "p2", productoNombre: "Jamaica", volumen: "500 ml", activa: true },
    { id: "p1", productoNombre: "Horchata", volumen: "1 L", activa: true },
  ],
  vendedores: [
    {
      id: "v1",
      nombre: "Abraham Pérez",
      cargas: [
        {
          id: "c1",
          numero: 1,
          estado: "aceptada",
          motivoRechazo: null,
          version: 1,
          respondidaEn: "2026-10-22T14:00:00.000Z",
          lineas: [{ presentacionId: "p1", piezas: 24 }],
        },
        {
          id: "c2",
          numero: 2,
          estado: "rechazada",
          motivoRechazo: "Faltan 2 cajas",
          version: 1,
          respondidaEn: "2026-10-22T17:00:00.000Z",
          lineas: [{ presentacionId: "p2", piezas: 12 }],
        },
      ],
    },
    {
      id: "v2",
      nombre: "Berta Ruiz",
      cargas: [
        {
          id: "c3",
          numero: 1,
          estado: "pendiente",
          motivoRechazo: null,
          version: 1,
          respondidaEn: null,
          lineas: [{ presentacionId: "p1", piezas: 10 }],
        },
      ],
    },
  ],
};

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1",
      login: "general",
      nombre: "General",
      perfil: "Administrador General",
      sucursal: null,
      permisos: [],
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede,
  });
}

describe("PantallaRecarga (T-27)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth(() => true);
    listarSucursales.mockResolvedValue([
      { id: "s-tj", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: true },
      { id: "s-mx", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
    ]);
    obtenerRejilla.mockResolvedValue(REJILLA);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin carga.gestionar no muestra la rejilla", async () => {
    mockAuth(() => false);
    render(<PantallaRecarga sucursal={null} />);
    expect(await screen.findByText("No tienes permiso para registrar cargas.")).toBeInTheDocument();
    expect(obtenerRejilla).not.toHaveBeenCalled();
  });

  it("pinta las cargas del dia con su estado, sus piezas, el total y el motivo del rechazo", async () => {
    render(<PantallaRecarga sucursal={null} />);
    expect(await screen.findByText("Faltan 2 cajas")).toBeInTheDocument();
    expect(obtenerRejilla).toHaveBeenCalledWith(HOY, "s-tj");
    expect(screen.getByText("Aceptada")).toBeInTheDocument();
    expect(screen.getByText("Rechazada")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getAllByText("24").length).toBeGreaterThan(0);
    // Una aceptada no se edita ni se elimina (D5); la rechazada y la pendiente si.
    expect(
      screen.queryByRole("button", { name: "Editar la carga n.º 1 de Abraham Pérez" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editar la carga n.º 2 de Abraham Pérez" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Eliminar la carga n.º 1 de Berta Ruiz" }),
    ).toBeInTheDocument();
  });

  it("Nueva carga abre una subcolumna editable y Guardar hace el POST", async () => {
    const usuario = userEvent.setup();
    crearCarga.mockResolvedValue(REJILLA.vendedores[1].cargas[0]);
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: "Nueva carga para Berta Ruiz" }));
    await usuario.type(screen.getByLabelText("Berta Ruiz · Horchata 1 L"), "30");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(crearCarga).toHaveBeenCalledWith({
        vendedorId: "v2",
        lineas: [{ presentacionId: "p1", piezas: 30 }],
      }),
    );
    await waitFor(() => expect(obtenerRejilla).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent("Carga guardada.");
  });

  it("Editar precarga las piezas y manda la version", async () => {
    const usuario = userEvent.setup();
    editarCarga.mockResolvedValue({ ...REJILLA.vendedores[1].cargas[0], version: 2 });
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(
      await screen.findByRole("button", { name: "Editar la carga n.º 1 de Berta Ruiz" }),
    );
    const campo = screen.getByLabelText("Berta Ruiz · Horchata 1 L") as HTMLInputElement;
    expect(campo.value).toBe("10");
    await usuario.clear(campo);
    await usuario.type(campo, "12");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(editarCarga).toHaveBeenCalledWith("c3", {
        version: 1,
        lineas: [{ presentacionId: "p1", piezas: 12 }],
      }),
    );
  });

  it("Eliminar pide confirmacion y manda la version", async () => {
    const usuario = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    eliminarCarga.mockResolvedValue({ id: "c3" });
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(
      await screen.findByRole("button", { name: "Eliminar la carga n.º 1 de Berta Ruiz" }),
    );
    expect(window.confirm).toHaveBeenCalledWith("¿Eliminar la carga n.º 1 de Berta Ruiz?");
    await waitFor(() => expect(eliminarCarga).toHaveBeenCalledWith("c3", 1));
  });

  it("un 409 muestra el mensaje del servidor", async () => {
    const usuario = userEvent.setup();
    editarCarga.mockRejectedValue(
      new ErrorApi(
        "fallo",
        409,
        "Una carga aceptada no se modifica: el vendedor ya la aceptó. Recarga la página.",
      ),
    );
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(
      await screen.findByRole("button", { name: "Editar la carga n.º 1 de Berta Ruiz" }),
    );
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Una carga aceptada no se modifica: el vendedor ya la aceptó. Recarga la página.",
    );
  });

  it("un 409 recarga la rejilla y cierra la captura; empezar otra limpia el mensaje (F8)", async () => {
    const usuario = userEvent.setup();
    editarCarga.mockRejectedValue(
      new ErrorApi("fallo", 409, "La carga cambió mientras la editabas. Recarga la página."),
    );
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(
      await screen.findByRole("button", { name: "Editar la carga n.º 1 de Berta Ruiz" }),
    );
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La carga cambió mientras la editabas. Recarga la página.",
    );
    // La rejilla se vuelve a pedir (la carga actual) y el mensaje sigue a la vista.
    await waitFor(() => expect(obtenerRejilla).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Nueva carga para Abraham Pérez" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("al editar, una presentacion dada de baja sale del borrador y la carga se guarda (F2)", async () => {
    const usuario = userEvent.setup();
    obtenerRejilla.mockResolvedValue({
      ...REJILLA,
      presentaciones: [
        ...REJILLA.presentaciones,
        { id: "p9", productoNombre: "Tamarindo", volumen: "1 L", activa: false },
      ],
      vendedores: [
        REJILLA.vendedores[0],
        {
          ...REJILLA.vendedores[1],
          cargas: [
            {
              ...REJILLA.vendedores[1].cargas[0],
              lineas: [
                { presentacionId: "p1", piezas: 10 },
                { presentacionId: "p9", piezas: 5 },
              ],
            },
          ],
        },
      ],
    });
    editarCarga.mockResolvedValue({ ...REJILLA.vendedores[1].cargas[0], version: 2 });
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(
      await screen.findByRole("button", { name: "Editar la carga n.º 1 de Berta Ruiz" }),
    );
    expect(screen.queryByLabelText("Berta Ruiz · Tamarindo 1 L")).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(editarCarga).toHaveBeenCalledWith("c3", {
        version: 1,
        lineas: [{ presentacionId: "p1", piezas: 10 }],
      }),
    );
  });

  it("piezas que no son enteras no se mandan", async () => {
    const usuario = userEvent.setup();
    render(<PantallaRecarga sucursal={null} />);
    await usuario.click(await screen.findByRole("button", { name: "Nueva carga para Berta Ruiz" }));
    await usuario.type(screen.getByLabelText("Berta Ruiz · Jamaica 500 ml"), "abc");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Las piezas son enteras, de 1 a 99 999.");
    expect(crearCarga).not.toHaveBeenCalled();
  });

  it("un dia anterior es de solo lectura (D8)", async () => {
    render(<PantallaRecarga sucursal={null} />);
    await screen.findByText("Faltan 2 cajas");
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-01-05" } });
    await waitFor(() => expect(obtenerRejilla).toHaveBeenLastCalledWith("2026-01-05", "s-tj"));
    expect(await screen.findByText(/solo lectura/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nueva carga/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar la carga/ })).not.toBeInTheDocument();
  });

  it("el selector global de sucursal elige la columna de MX", async () => {
    render(<PantallaRecarga sucursal="MX" />);
    await waitFor(() => expect(obtenerRejilla).toHaveBeenCalledWith(HOY, "s-mx"));
  });
});

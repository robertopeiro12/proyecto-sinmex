import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as lib from "@/lib/retornos";
import * as vend from "@/lib/vendedores";
import type { DiaRetorno } from "@/lib/retornos";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaRetorno } from "./pantalla-retorno";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/retornos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/retornos")>();
  return { ...real, obtenerRetorno: vi.fn(), guardarRetorno: vi.fn() };
});
vi.mock("@/lib/vendedores", () => ({ listarVendedores: vi.fn() }));

const HOY = hoyEnTijuana();
const vendedor = (id: string, nombre: string, activo = true) => ({
  id, nombre, login: id, sucursalId: "s", sucursalCodigo: "TJ", folioSegmento: "AP", activo,
});
const dia = (id: string, nombre: string): DiaRetorno => ({
  fecha: HOY,
  vendedor: { id, nombre },
  sucursal: { id: "s", codigo: "TJ" },
  lineas: [
    { presentacionId: "p1", producto: "Jamaica", presentacion: "1 L", activa: true, piezas: 3, cargadas: 40 },
    { presentacionId: "p2", producto: "Horchata", presentacion: "1 L", activa: true, piezas: 0, cargadas: 0 },
  ],
  totalPiezas: 3,
  actualizadoEn: null,
});

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

const PERMISO = "retorno.gestionar";
const piezas = (nombre: string) => screen.getByLabelText(`Piezas retornadas de ${nombre}`);
const TABLA = { name: "Retorno del vendedor" };

async function elegir(nombre: string) {
  const lista = await screen.findByLabelText("Vendedor");
  await waitFor(() => expect(within(lista).getByRole("option", { name: nombre })).toBeInTheDocument());
  await userEvent.selectOptions(lista, nombre);
}

describe("PantallaRetorno", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vend.listarVendedores).mockResolvedValue([
      vendedor("v1", "Ana Pérez"), vendedor("v2", "Beto Ruiz"), vendedor("v3", "Cata Baja", false),
    ]);
    vi.mocked(lib.obtenerRetorno).mockImplementation(async (_f, v) => dia(v, v === "v1" ? "Ana Pérez" : "Beto Ruiz"));
    vi.mocked(lib.guardarRetorno).mockResolvedValue({ ...dia("v1", "Ana Pérez"), totalPiezas: 8 });
  });

  it("sin permiso dice que no hay permiso", () => {
    mockAuth([]);
    render(<PantallaRetorno sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(lib.obtenerRetorno).not.toHaveBeenCalled();
  });

  it("con todas las sucursales pide elegir una", () => {
    mockAuth([PERMISO], null);
    render(<PantallaRetorno sucursal={null} />);
    expect(screen.getByText(/Elige una sucursal/)).toBeInTheDocument();
    expect(vend.listarVendedores).not.toHaveBeenCalled();
  });

  it("lista solo los vendedores activos y no consulta hasta elegir uno", async () => {
    mockAuth([PERMISO]);
    render(<PantallaRetorno sucursal={null} />);
    const lista = await screen.findByLabelText("Vendedor");
    await waitFor(() => expect(within(lista).getByRole("option", { name: "Ana Pérez" })).toBeInTheDocument());
    expect(within(lista).queryByRole("option", { name: "Cata Baja" })).toBeNull();
    expect(vend.listarVendedores).toHaveBeenCalledWith("TJ");
    expect(lib.obtenerRetorno).not.toHaveBeenCalled();
  });

  it("al elegir vendedor carga el día con cargadas, piezas y total", async () => {
    mockAuth([PERMISO]);
    render(<PantallaRetorno sucursal={null} />);
    await elegir("Ana Pérez");
    await screen.findByRole("table", TABLA);
    expect(lib.obtenerRetorno).toHaveBeenCalledWith(HOY, "v1");
    for (const t of ["Producto", "Presentación", "Cargadas", "Piezas retornadas"]) {
      expect(screen.getByRole("columnheader", { name: t })).toBeInTheDocument();
    }
    expect(piezas("Jamaica 1 L")).toHaveValue("3");
    expect(within(screen.getByRole("row", { name: /Jamaica/ })).getByText("40")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Total/ })).getByText("3")).toBeInTheDocument();
  });

  it("Guardar manda todas las líneas y avisa", async () => {
    mockAuth([PERMISO]);
    render(<PantallaRetorno sucursal={null} />);
    await elegir("Ana Pérez");
    await screen.findByRole("table", TABLA);
    await userEvent.type(piezas("Horchata 1 L"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Guardar retorno" }));
    expect(lib.guardarRetorno).toHaveBeenCalledWith({
      fecha: HOY,
      vendedor: "v1",
      lineas: [
        { presentacionId: "p1", piezas: 3 },
        { presentacionId: "p2", piezas: 5 },
      ],
    });
    expect(await screen.findByText("Retorno guardado.")).toBeInTheDocument();
  });

  it("con una entrada inválida deshabilita Guardar y avisa en la fila", async () => {
    mockAuth([PERMISO]);
    render(<PantallaRetorno sucursal={null} />);
    await elegir("Ana Pérez");
    await screen.findByRole("table", TABLA);
    await userEvent.type(piezas("Horchata 1 L"), "1.5");
    expect(screen.getByRole("button", { name: "Guardar retorno" })).toBeDisabled();
    expect(piezas("Horchata 1 L")).toHaveAttribute("aria-invalid", "true");
    expect(within(screen.getByRole("row", { name: /Horchata/ })).getByText("Solo piezas enteras")).toBeInTheDocument();
    expect(lib.guardarRetorno).not.toHaveBeenCalled();
  });

  it("la fecha no permite mañana y una futura tecleada no se consulta", async () => {
    mockAuth([PERMISO]);
    render(<PantallaRetorno sucursal={null} />);
    await elegir("Ana Pérez");
    await screen.findByRole("table", TABLA);
    const fecha = screen.getByLabelText("Fecha") as HTMLInputElement;
    expect(fecha.max).toBe(HOY);
    fireEvent.change(fecha, { target: { value: "2999-01-01" } });
    await waitFor(() => expect(fecha.value).toBe(HOY));
    expect(lib.obtenerRetorno).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("cambiar de vendedor con cambios pregunta; cancelar no cambia nada", async () => {
    mockAuth([PERMISO]);
    render(<PantallaRetorno sucursal={null} />);
    await elegir("Ana Pérez");
    await screen.findByRole("table", TABLA);
    await userEvent.type(piezas("Horchata 1 L"), "5");
    await userEvent.selectOptions(screen.getByLabelText("Vendedor"), "Beto Ruiz");
    const ventana = await screen.findByRole("alertdialog");
    await userEvent.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect((screen.getByLabelText("Vendedor") as HTMLSelectElement).value).toBe("v1");
    expect(piezas("Horchata 1 L")).toHaveValue("5");
    expect(lib.obtenerRetorno).toHaveBeenCalledTimes(1);

    await userEvent.selectOptions(screen.getByLabelText("Vendedor"), "Beto Ruiz");
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(lib.obtenerRetorno).toHaveBeenCalledWith(HOY, "v2"));
  });

  it("cambiar de fecha con cambios pregunta; cancelar conserva la fecha", async () => {
    mockAuth([PERMISO]);
    render(<PantallaRetorno sucursal={null} />);
    await elegir("Ana Pérez");
    await screen.findByRole("table", TABLA);
    await userEvent.type(piezas("Horchata 1 L"), "5");
    const fecha = screen.getByLabelText("Fecha") as HTMLInputElement;
    fireEvent.change(fecha, { target: { value: "2026-01-05" } });
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(fecha.value).toBe(HOY);
    expect(lib.obtenerRetorno).toHaveBeenCalledTimes(1);
  });

  it("cambiar sin cambios no pregunta", async () => {
    mockAuth([PERMISO]);
    render(<PantallaRetorno sucursal={null} />);
    await elegir("Ana Pérez");
    await screen.findByRole("table", TABLA);
    await userEvent.selectOptions(screen.getByLabelText("Vendedor"), "Beto Ruiz");
    await waitFor(() => expect(lib.obtenerRetorno).toHaveBeenCalledWith(HOY, "v2"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("el error del servidor sale en un aviso con su mensaje", async () => {
    mockAuth([PERMISO]);
    vi.mocked(lib.guardarRetorno).mockRejectedValue(new ErrorApi("x", 400, "No se puede registrar un retorno de una fecha futura."));
    render(<PantallaRetorno sucursal={null} />);
    await elegir("Ana Pérez");
    await screen.findByRole("table", TABLA);
    await userEvent.type(piezas("Horchata 1 L"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Guardar retorno" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se puede registrar un retorno de una fecha futura.");
  });
});

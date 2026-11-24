import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as ops from "@/lib/operaciones-almacen";
import type { OperacionAlmacen } from "@/lib/operaciones-almacen";
import * as motivosLib from "@/lib/motivos-merma";
import * as productosLib from "@/lib/productos";
import * as sucursalesLib from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaRegistroOperacion } from "./pantalla-registro-operacion";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/operaciones-almacen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/operaciones-almacen")>();
  return { ...real, listarOperaciones: vi.fn(), crearOperacion: vi.fn(), editarOperacion: vi.fn(), eliminarOperacion: vi.fn() };
});
vi.mock("@/lib/motivos-merma", () => ({ listarMotivosMerma: vi.fn() }));
vi.mock("@/lib/productos", () => ({ listarProductos: vi.fn() }));
vi.mock("@/lib/sucursales", () => ({ listarSucursales: vi.fn() }));

const HOY = hoyEnTijuana();

function mockAuth(permisos: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { id: "u1", login: "ana", nombre: "Ana", perfil: "x", sucursal: { id: "s", codigo: "TJ", nombre: "TJ" }, permisos },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (c: string) => permisos.includes(c),
  });
}

const retiro = (id: string, m: Partial<OperacionAlmacen> = {}): OperacionAlmacen => ({
  id,
  tipo: "retiro_merma",
  sucursal: { id: "s-TJ", codigo: "TJ" },
  fecha: HOY,
  origen: null,
  destino: null,
  motivo: null,
  trabajador: null,
  comentario: null,
  lineas: [{ presentacionId: "p1", nombre: "Horchata 1 L", producto: "Horchata", volumen: "1 L", piezas: 12 }],
  piezas: 12,
  capturo: "Lupe",
  hora: "08:15",
  actualizadoEn: "2026-11-24T16:15:00.123456Z",
  editable: true,
  envio: null,
  estado: "pendiente",
  resolucion: null,
  ...m,
});

describe("Retiro de merma en el Registro de Operación", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([]);
    vi.mocked(motivosLib.listarMotivosMerma).mockResolvedValue([]);
    vi.mocked(productosLib.listarProductos).mockResolvedValue([
      { id: "pr1", nombre: "Horchata", activo: true, presentaciones: [{ id: "p1", volumen: "1 L" }] },
    ] as never);
  });

  it("la pestaña sale al final y solo con operacion.retiro_merma", async () => {
    mockAuth(["operacion.merma", "operacion.retiro_merma"]);
    vi.mocked(ops.listarOperaciones).mockResolvedValue({ fecha: HOY, hoy: HOY, operaciones: [] });
    const { unmount } = render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Merma", "Retiro de merma"]);
    unmount();
    mockAuth(["operacion.merma"]);
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Merma"]);
  });

  it("pendiente: etiqueta de estado y Editar/Eliminar", async () => {
    mockAuth(["operacion.retiro_merma"]);
    vi.mocked(ops.listarOperaciones).mockResolvedValue({ fecha: HOY, hoy: HOY, operaciones: [retiro("r1")] });
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    const fila = within(await screen.findByRole("row", { name: /Lupe/ }));
    expect(fila.getByText("Pendiente")).toHaveAttribute("data-tono", "advertencia");
    expect(fila.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(fila.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar retiro de merma" })).toBeInTheDocument();
  });

  it("autorizado: quién autorizó y cuándo, sin Editar ni Eliminar", async () => {
    mockAuth(["operacion.retiro_merma"]);
    vi.mocked(ops.listarOperaciones).mockResolvedValue({
      fecha: HOY,
      hoy: HOY,
      operaciones: [retiro("r1", { estado: "autorizado", editable: false, resolucion: { por: "Roberto", en: "2026-11-25 10:30", motivo: null } })],
    });
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    const fila = within(await screen.findByRole("row", { name: /Lupe/ }));
    expect(fila.getByText("Autorizado")).toHaveAttribute("data-tono", "exito");
    expect(fila.getByText("Autorizó Roberto el miércoles 25 de noviembre a las 10:30")).toBeInTheDocument();
    expect(fila.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(fila.queryByRole("button", { name: "Eliminar" })).toBeNull();
  });

  it("rechazado: quién, cuándo y el motivo; editarlo avisa que vuelve a Pendiente", async () => {
    mockAuth(["operacion.retiro_merma"]);
    const u = userEvent.setup();
    vi.mocked(ops.listarOperaciones).mockResolvedValue({
      fecha: HOY,
      hoy: HOY,
      operaciones: [retiro("r1", { estado: "rechazado", resolucion: { por: "Roberto", en: "2026-11-25 10:30", motivo: "Faltan fotos" } })],
    });
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    const fila = within(await screen.findByRole("row", { name: /Lupe/ }));
    expect(fila.getByText("Rechazado")).toHaveAttribute("data-tono", "error");
    expect(fila.getByText("Rechazó Roberto el miércoles 25 de noviembre a las 10:30: Faltan fotos")).toBeInTheDocument();
    await u.click(fila.getByRole("button", { name: "Editar" }));
    expect(await screen.findByText(/vuelve a Pendiente/)).toBeInTheDocument();
  });

  it("un 409 al eliminar recarga la lista (si ya lo autorizaron, desaparecen Editar y Eliminar)", async () => {
    mockAuth(["operacion.retiro_merma"]);
    const u = userEvent.setup();
    vi.mocked(ops.listarOperaciones).mockResolvedValueOnce({ fecha: HOY, hoy: HOY, operaciones: [retiro("r1")] });
    vi.mocked(ops.listarOperaciones).mockResolvedValue({
      fecha: HOY,
      hoy: HOY,
      operaciones: [retiro("r1", { estado: "autorizado", editable: false, resolucion: { por: "Roberto", en: "2026-11-25 10:30", motivo: null } })],
    });
    vi.mocked(ops.eliminarOperacion).mockRejectedValue(new ErrorApi("conflicto", 409, "Un retiro autorizado ya no se puede corregir ni dar de baja."));
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    const fila = within(await screen.findByRole("row", { name: /Lupe/ }));
    await u.click(fila.getByRole("button", { name: "Eliminar" }));
    await u.click(await screen.findByRole("button", { name: "Eliminar registro" }));
    await waitFor(() => expect(ops.listarOperaciones).toHaveBeenCalledTimes(2));
    const despues = within(await screen.findByRole("row", { name: /Lupe/ }));
    await waitFor(() => expect(despues.queryByRole("button", { name: "Eliminar" })).toBeNull());
    expect(despues.queryByRole("button", { name: "Editar" })).toBeNull();
    // El mensaje del 409 sigue a la vista aunque la lista se haya vuelto a pedir.
    expect(screen.getByText("Un retiro autorizado ya no se puede corregir ni dar de baja.")).toBeInTheDocument();
  });

  it("registrar un retiro lo manda con tipo retiro_merma", async () => {
    mockAuth(["operacion.retiro_merma"]);
    const u = userEvent.setup();
    vi.mocked(ops.listarOperaciones).mockResolvedValue({ fecha: HOY, hoy: HOY, operaciones: [] });
    vi.mocked(ops.crearOperacion).mockResolvedValue(retiro("n"));
    render(<PantallaRegistroOperacion sucursal={null} pestana={null} />);
    await u.click(await screen.findByRole("button", { name: "Registrar retiro de merma" }));
    await u.type(await screen.findByLabelText("Piezas de Horchata 1 L"), "5");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(ops.crearOperacion).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: "retiro_merma", sucursal: "TJ", lineas: [{ presentacionId: "p1", piezas: 5 }] }),
      ),
    );
  });
});

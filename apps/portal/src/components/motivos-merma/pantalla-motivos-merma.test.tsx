import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as lib from "@/lib/motivos-merma";
import { PantallaMotivosMerma } from "./pantalla-motivos-merma";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/motivos-merma", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/motivos-merma")>();
  return {
    ...real,
    listarMotivosMerma: vi.fn(),
    crearMotivoMerma: vi.fn(),
    editarMotivoMerma: vi.fn(),
    eliminarMotivoMerma: vi.fn(),
  };
});

const M1 = { id: "m1", nombre: "Caducado por fecha", aplicaAlmacen: true, aplicaCliente: false, aplicaVehiculo: true, activo: true };
const MOTIVOS = [M1, { ...M1, id: "m2", nombre: "Lote en mal estado", aplicaCliente: true }];

function sesion(puede: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { sucursal: null, permisos: puede ? [lib.PERMISO_MOTIVOS_MERMA] : [] } as never,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: () => puede,
  });
}

describe("PantallaMotivosMerma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.listarMotivosMerma).mockResolvedValue(MOTIVOS);
  });

  it("lista cada motivo con Almacén, Cliente y Vehículo en Sí/No", async () => {
    sesion(true);
    render(<PantallaMotivosMerma />);
    const fila = (await screen.findByText("Caducado por fecha")).closest("tr")!;
    expect(within(fila).getAllByRole("cell").map((c) => c.textContent)).toEqual(
      expect.arrayContaining(["Caducado por fecha", "Sí", "No", "Sí"]),
    );
    expect(within(fila).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo motivo" })).toBeInTheDocument();
  });

  it("sin motivo_merma.gestionar solo se lee", async () => {
    sesion(false);
    render(<PantallaMotivosMerma />);
    const fila = (await screen.findByText("Caducado por fecha")).closest("tr")!;
    expect(within(fila).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo motivo" })).toBeNull();
  });

  it("el alta manda el nombre y las tres casillas (todas prendidas por omisión)", async () => {
    sesion(true);
    vi.mocked(lib.crearMotivoMerma).mockResolvedValue(M1);
    render(<PantallaMotivosMerma />);
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo motivo" }));
    await userEvent.type(screen.getByLabelText("Nombre del motivo"), "Roto");
    await userEvent.click(screen.getByLabelText("Vehículo"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.crearMotivoMerma).toHaveBeenCalledWith({
      nombre: "Roto",
      aplicaAlmacen: true,
      aplicaCliente: true,
      aplicaVehiculo: false,
    });
  });

  it("no deja guardar con las tres casillas apagadas", async () => {
    sesion(true);
    render(<PantallaMotivosMerma />);
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo motivo" }));
    await userEvent.type(screen.getByLabelText("Nombre del motivo"), "Roto");
    for (const c of ["Almacén", "Cliente", "Vehículo"]) await userEvent.click(screen.getByLabelText(c));
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("editar precarga y un nombre repetido muestra el mensaje del servidor", async () => {
    sesion(true);
    vi.mocked(lib.editarMotivoMerma).mockRejectedValue(
      new ErrorApi("conflicto", 409, 'Ya existe un motivo de merma llamado "Roto".'),
    );
    render(<PantallaMotivosMerma />);
    const fila = (await screen.findByText("Caducado por fecha")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("Cliente")).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.editarMotivoMerma).toHaveBeenCalledWith("m1", {
      nombre: "Caducado por fecha",
      aplicaAlmacen: true,
      aplicaCliente: false,
      aplicaVehiculo: true,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent('Ya existe un motivo de merma llamado "Roto".');
  });

  it("eliminar pregunta, da de baja y recarga", async () => {
    sesion(true);
    vi.mocked(lib.eliminarMotivoMerma).mockResolvedValue({ id: "m1" });
    render(<PantallaMotivosMerma />);
    const fila = (await screen.findByText("Caducado por fecha")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    const ventana = screen.getByRole("alertdialog", { name: '¿Eliminar el motivo "Caducado por fecha"?' });
    await userEvent.click(within(ventana).getByRole("button", { name: "Eliminar motivo" }));
    await vi.waitFor(() => expect(lib.listarMotivosMerma).toHaveBeenCalledTimes(2));
    expect(lib.eliminarMotivoMerma).toHaveBeenCalledWith("m1");
  });
});

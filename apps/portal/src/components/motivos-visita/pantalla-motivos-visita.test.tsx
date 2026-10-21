import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as lib from "@/lib/motivos-visita";
import { PantallaMotivosVisita } from "./pantalla-motivos-visita";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/motivos-visita", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/motivos-visita")>();
  return {
    ...real,
    listarMotivosVisita: vi.fn(),
    crearMotivoVisita: vi.fn(),
    editarMotivoVisita: vi.fn(),
    eliminarMotivoVisita: vi.fn(),
  };
});

const MOTIVOS = [
  { id: "m1", nombre: "Cerrado", exigeFoto: true, exigeAtendio: false },
  { id: "m2", nombre: "No estaba el encargado", exigeFoto: true, exigeAtendio: true },
];

function sesion(puede: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { sucursal: null, permisos: puede ? [lib.PERMISO_MOTIVOS_VISITA] : [] } as never,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: () => puede,
  });
}

describe("PantallaMotivosVisita", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.listarMotivosVisita).mockResolvedValue(MOTIVOS);
  });

  it("lista cada motivo con sus casillas en Sí/No y, con permiso, Editar y Eliminar", async () => {
    sesion(true);
    render(<PantallaMotivosVisita />);
    const fila = (await screen.findByText("Cerrado")).closest("tr")!;
    expect(within(fila).getAllByRole("cell").map((c) => c.textContent)).toEqual(
      expect.arrayContaining(["Cerrado", "Sí", "No"]),
    );
    expect(within(fila).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(within(fila).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo motivo" })).toBeInTheDocument();
  });

  it("sin motivo_visita.gestionar solo se lee: sin alta ni botones por fila", async () => {
    sesion(false);
    render(<PantallaMotivosVisita />);
    const fila = (await screen.findByText("Cerrado")).closest("tr")!;
    expect(within(fila).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo motivo" })).toBeNull();
  });

  it("el alta manda el nombre y las dos casillas", async () => {
    sesion(true);
    vi.mocked(lib.crearMotivoVisita).mockResolvedValue({ id: "m3", nombre: "Bodega", exigeFoto: true, exigeAtendio: false });
    render(<PantallaMotivosVisita />);
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo motivo" }));
    expect(within(screen.getByRole("dialog", { name: "Nuevo motivo" })).getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nombre del motivo"), "Bodega");
    await userEvent.click(screen.getByLabelText("Exige foto"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.crearMotivoVisita).toHaveBeenCalledWith({ nombre: "Bodega", exigeFoto: true, exigeAtendio: false });
    await vi.waitFor(() => expect(lib.listarMotivosVisita).toHaveBeenCalledTimes(2));
  });

  it("editar precarga el motivo y manda lo cambiado", async () => {
    sesion(true);
    vi.mocked(lib.editarMotivoVisita).mockResolvedValue({ ...MOTIVOS[0], exigeAtendio: true });
    render(<PantallaMotivosVisita />);
    const fila = (await screen.findByText("Cerrado")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("Nombre del motivo")).toHaveValue("Cerrado");
    expect(screen.getByLabelText("Exige foto")).toBeChecked();
    await userEvent.click(screen.getByLabelText("Exige nombre de quien atendió"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(lib.editarMotivoVisita).toHaveBeenCalledWith("m1", { nombre: "Cerrado", exigeFoto: true, exigeAtendio: true });
  });

  it("un nombre repetido muestra el mensaje del servidor (409)", async () => {
    sesion(true);
    vi.mocked(lib.crearMotivoVisita).mockRejectedValue(
      new ErrorApi("conflicto", 409, 'Ya existe un motivo de visita llamado "Cerrado".'),
    );
    render(<PantallaMotivosVisita />);
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo motivo" }));
    await userEvent.type(screen.getByLabelText("Nombre del motivo"), "cerrado");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('Ya existe un motivo de visita llamado "Cerrado".');
  });

  it("eliminar pregunta en la ventana, da de baja y recarga", async () => {
    sesion(true);
    vi.mocked(lib.eliminarMotivoVisita).mockResolvedValue({ id: "m1" });
    render(<PantallaMotivosVisita />);
    const fila = (await screen.findByText("Cerrado")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    const ventana = screen.getByRole("alertdialog", { name: '¿Eliminar el motivo "Cerrado"?' });
    expect(ventana).toHaveTextContent("Las visitas ya registradas lo conservan, pero las tablets dejarán de ofrecerlo.");
    await userEvent.click(within(ventana).getByRole("button", { name: "Eliminar motivo" }));
    await vi.waitFor(() => expect(lib.listarMotivosVisita).toHaveBeenCalledTimes(2));
    expect(lib.eliminarMotivoVisita).toHaveBeenCalledTimes(1);
    expect(lib.eliminarMotivoVisita).toHaveBeenCalledWith("m1");
  });

  it("cancelar la confirmación no da de baja", async () => {
    sesion(true);
    render(<PantallaMotivosVisita />);
    const fila = (await screen.findByText("Cerrado")).closest("tr")!;
    await userEvent.click(within(fila).getByRole("button", { name: "Eliminar" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    expect(lib.eliminarMotivoVisita).not.toHaveBeenCalled();
  });
});

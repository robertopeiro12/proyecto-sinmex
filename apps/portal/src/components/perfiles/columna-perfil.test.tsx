import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorApi } from "@/lib/api";
import * as lib from "@/lib/perfiles";
import { ColumnaPerfil } from "./columna-perfil";

vi.mock("@/lib/perfiles", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/perfiles")>();
  return { ...real, renombrarPerfil: vi.fn(), darDeBajaPerfil: vi.fn() };
});

const PERFIL: lib.Perfil = {
  id: "p1",
  nombre: "Ventas",
  esMaestro: false,
  permisos: [],
} as lib.Perfil;

describe("ColumnaPerfil", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Dar de baja pregunta y, confirmado, da de baja", async () => {
    vi.mocked(lib.darDeBajaPerfil).mockResolvedValue(undefined as never);
    const alCambiar = vi.fn();
    render(<ColumnaPerfil perfil={PERFIL} alCambiar={alCambiar} />);
    await userEvent.click(screen.getByRole("button", { name: "Dar de baja" }));
    const ventana = screen.getByRole("alertdialog", {
      name: '¿Dar de baja el perfil "Ventas"?',
    });
    expect(ventana).toHaveTextContent(
      "Solo se puede si ningún usuario activo lo tiene.",
    );
    await userEvent.click(
      within(ventana).getByRole("button", { name: "Dar de baja" }),
    );
    await vi.waitFor(() => expect(alCambiar).toHaveBeenCalledTimes(1));
    expect(lib.darDeBajaPerfil).toHaveBeenCalledTimes(1);
    expect(lib.darDeBajaPerfil).toHaveBeenCalledWith("p1");
  });

  it("Cancelar no da de baja", async () => {
    const alCambiar = vi.fn();
    render(<ColumnaPerfil perfil={PERFIL} alCambiar={alCambiar} />);
    await userEvent.click(screen.getByRole("button", { name: "Dar de baja" }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancelar",
      }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(lib.darDeBajaPerfil).not.toHaveBeenCalled();
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it("el rechazo del servidor se muestra", async () => {
    vi.mocked(lib.darDeBajaPerfil).mockRejectedValue(
      new ErrorApi(
        "conflicto",
        409,
        "Hay usuarios activos con este perfil. Reasígnalos antes de darlo de baja.",
      ),
    );
    const alCambiar = vi.fn();
    render(<ColumnaPerfil perfil={PERFIL} alCambiar={alCambiar} />);
    await userEvent.click(screen.getByRole("button", { name: "Dar de baja" }));
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Dar de baja",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Hay usuarios activos con este perfil. Reasígnalos antes de darlo de baja.",
    );
    expect(alCambiar).not.toHaveBeenCalled();
  });
});

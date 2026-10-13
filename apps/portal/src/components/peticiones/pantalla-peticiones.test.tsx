import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as peticionesLib from "@/lib/peticiones";
import { PantallaPeticiones } from "./pantalla-peticiones";

vi.mock("@/lib/peticiones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/peticiones")>();
  return { ...real, listarPeticiones: vi.fn() };
});
vi.mock("@/components/auth/auth-provider");

const listarPeticiones = vi.mocked(peticionesLib.listarPeticiones);

function mockAuth(puede: (clave: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: false, cerrarSesion: vi.fn(), puede });
}

describe("PantallaPeticiones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarPeticiones.mockResolvedValue([]);
  });

  it("sin peticiones.gestionar lo dice y no pide nada", () => {
    mockAuth((clave) => clave !== "peticiones.gestionar");
    render(<PantallaPeticiones sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver peticiones")).toBeInTheDocument();
    expect(listarPeticiones).not.toHaveBeenCalled();
  });

  it("abre en Pendientes con la sucursal del filtro; Historial pide las resueltas", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaPeticiones sucursal="TJ" />);
    expect(await screen.findByText("No hay peticiones pendientes.")).toBeInTheDocument();
    expect(listarPeticiones).toHaveBeenCalledWith("pendiente", "TJ");
    expect(screen.getByRole("button", { name: "Pendientes" })).toHaveAttribute("aria-pressed", "true");

    await usuario.click(screen.getByRole("button", { name: "Historial" }));
    expect(await screen.findByText("No hay peticiones resueltas.")).toBeInTheDocument();
    expect(listarPeticiones).toHaveBeenLastCalledWith("historial", "TJ");
  });
});

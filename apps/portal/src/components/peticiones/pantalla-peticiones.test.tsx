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

  it("mientras carga la sesión dice Cargando…, no \"No tienes permiso\"", () => {
    vi.mocked(useAuth).mockReturnValue({ usuario: null, cargando: true, cerrarSesion: vi.fn(), puede: () => false });
    render(<PantallaPeticiones sucursal={null} />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText(/No tienes permiso/)).not.toBeInTheDocument();
  });

  it("sin peticiones.gestionar lo dice y no pide nada", () => {
    mockAuth((clave) => clave !== "peticiones.gestionar");
    render(<PantallaPeticiones sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(listarPeticiones).not.toHaveBeenCalled();
  });

  it("encabezado con su explicación; abre en Pendientes con la sucursal del filtro; Historial pide las resueltas", async () => {
    mockAuth(() => true);
    const usuario = userEvent.setup();
    render(<PantallaPeticiones sucursal="TJ" />);
    expect(screen.getByRole("heading", { level: 1, name: "Peticiones" })).toBeInTheDocument();
    expect(screen.getByText(/borrar un pago/)).toBeInTheDocument();
    expect(await screen.findByText("No hay peticiones pendientes.")).toBeInTheDocument();
    expect(listarPeticiones).toHaveBeenCalledWith("pendiente", "TJ");
    expect(screen.getByRole("tab", { name: "Pendientes" })).toHaveAttribute("aria-selected", "true");

    await usuario.click(screen.getByRole("tab", { name: "Historial" }));
    expect(screen.getByRole("tab", { name: "Historial" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("No hay peticiones resueltas.")).toBeInTheDocument();
    expect(listarPeticiones).toHaveBeenLastCalledWith("historial", "TJ");
  });
});

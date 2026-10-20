import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UsuarioSesion } from "@/lib/api";
import { BloqueUsuario } from "./bloque-usuario";

const ATADO: UsuarioSesion = {
  id: "u2",
  login: "ana",
  nombre: "Admin Local",
  perfil: "Administrador General",
  sucursal: { id: "s1", codigo: "TJ", nombre: "Tijuana" },
  permisos: [],
};

describe("BloqueUsuario", () => {
  it("iniciales, nombre y perfil; sin el código General ni el de sucursal", () => {
    render(<BloqueUsuario usuario={ATADO} onCerrarSesion={vi.fn()} />);
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("Admin Local")).toBeInTheDocument();
    expect(screen.getByText("Administrador General")).toBeInTheDocument();
    expect(screen.queryByText("General")).not.toBeInTheDocument();
    expect(screen.queryByText("TJ")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Cerrar sesión" })).not.toBeInTheDocument();
  });

  it("Cerrar sesión vive en su menú", async () => {
    const usuario = userEvent.setup();
    const onCerrarSesion = vi.fn();
    render(<BloqueUsuario usuario={ATADO} onCerrarSesion={onCerrarSesion} />);
    await usuario.click(screen.getByRole("button", { name: /Admin Local/ }));
    await usuario.click(await screen.findByRole("menuitem", { name: "Cerrar sesión" }));
    expect(onCerrarSesion).toHaveBeenCalledTimes(1);
  });

  it("mientras carga la sesión deja el lugar sin botón", () => {
    render(<BloqueUsuario usuario={null} onCerrarSesion={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

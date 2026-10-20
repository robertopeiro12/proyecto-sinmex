import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Sucursal } from "@/lib/sucursales";
import { BloqueSucursal } from "./bloque-sucursal";
import type { SucursalActual } from "./use-sucursal-actual";

const OPCIONES: Sucursal[] = [
  { id: "s1", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false },
  { id: "s2", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
];

function sucursal(cambios: Partial<SucursalActual> = {}): SucursalActual {
  return {
    codigo: "TJ",
    nombre: "Tijuana",
    siglas: "TJ",
    color: "var(--suc-tj)",
    puedeElegir: true,
    opciones: OPCIONES,
    elegir: vi.fn(),
    ...cambios,
  };
}

describe("BloqueSucursal", () => {
  it("quien puede elegir abre la lista: todas y cada sucursal, con palomita en la actual", async () => {
    const usuario = userEvent.setup();
    const actual = sucursal();
    render(<BloqueSucursal sucursal={actual} />);
    const boton = screen.getByRole("button", { name: "Sucursal: Tijuana. Cambiar de sucursal" });
    expect(boton).toHaveTextContent("Tijuana");
    await usuario.click(boton);
    expect(await screen.findByRole("menuitemradio", { name: "Tijuana" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Todas las sucursales" })).toHaveAttribute("aria-checked", "false");
    await usuario.click(screen.getByRole("menuitemradio", { name: "Mexicali" }));
    expect(actual.elegir).toHaveBeenCalledWith("MX");
  });

  it("elegir Todas las sucursales manda null", async () => {
    const usuario = userEvent.setup();
    const actual = sucursal();
    render(<BloqueSucursal sucursal={actual} />);
    await usuario.click(screen.getByRole("button", { name: /Cambiar de sucursal/ }));
    await usuario.click(await screen.findByRole("menuitemradio", { name: "Todas las sucursales" }));
    expect(actual.elegir).toHaveBeenCalledWith(null);
  });

  it("un usuario atado ve su sucursal sin flecha ni lista", () => {
    render(<BloqueSucursal sucursal={sucursal({ puedeElegir: false })} />);
    expect(screen.getByText("Tijuana")).toBeInTheDocument();
    expect(screen.getByText("Sucursal")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

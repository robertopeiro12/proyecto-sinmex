import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FilaEditable } from "@/lib/rutas";
import { ListaRutaDiaria } from "./lista-ruta-diaria";

const filas: FilaEditable[] = [
  { clienteId: "a", clienteNombre: "Abarrotes A", origen: "oficina" },
  { clienteId: "b", clienteNombre: "Tienda B", origen: "vendedor" },
];

describe("ListaRutaDiaria", () => {
  it("numera las filas y marca las que agregó el vendedor, sin botón de quitar", () => {
    render(<ListaRutaDiaria filas={filas} onMover={vi.fn()} onQuitar={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Ruta del día" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("1Abarrotes A"),
      expect.stringContaining("2Tienda B"),
    ]);
    expect(screen.getByText("agregada por el vendedor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar Abarrotes A" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar Tienda B" })).toBeNull();
  });

  it("subir, bajar y quitar avisan con el índice; los extremos no se mueven", async () => {
    const onMover = vi.fn();
    const onQuitar = vi.fn();
    const usuario = userEvent.setup();
    render(<ListaRutaDiaria filas={filas} onMover={onMover} onQuitar={onQuitar} />);

    expect(screen.getByRole("button", { name: "Subir Abarrotes A" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar Tienda B" })).toBeDisabled();
    await usuario.click(screen.getByRole("button", { name: "Subir Tienda B" }));
    expect(onMover).toHaveBeenCalledWith(1, 0);
    await usuario.click(screen.getByRole("button", { name: "Bajar Abarrotes A" }));
    expect(onMover).toHaveBeenCalledWith(0, 1);
    await usuario.click(screen.getByRole("button", { name: "Quitar Abarrotes A" }));
    expect(onQuitar).toHaveBeenCalledWith(0);
  });

  it("si todas son del vendedor, el encabezado lo dice (D3)", () => {
    render(<ListaRutaDiaria filas={[filas[1]]} onMover={vi.fn()} onQuitar={vi.fn()} />);
    expect(screen.getByText("Ruta armada por el vendedor")).toBeInTheDocument();
  });
});

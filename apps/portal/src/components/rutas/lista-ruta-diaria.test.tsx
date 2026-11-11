import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FilaEditable } from "@/lib/rutas";
import { ListaRutaDiaria } from "./lista-ruta-diaria";

const filas: FilaEditable[] = [
  { clienteId: "a", clienteNombre: "Abarrotes A", origen: "semanal", recado: "Vender solo de contado", notasAsignadas: 0 },
  { clienteId: "m", clienteNombre: "Mini M", origen: "oficina", recado: null, notasAsignadas: 0 },
  { clienteId: "b", clienteNombre: "Tienda B", origen: "vendedor", recado: null, notasAsignadas: 0 },
];

function pintar(extra: Partial<Parameters<typeof ListaRutaDiaria>[0]> = {}) {
  const props = { filas, editable: true, onMover: vi.fn(), onQuitar: vi.fn(), onRecado: vi.fn(), ...extra };
  render(<ListaRutaDiaria {...props} />);
  return props;
}

describe("ListaRutaDiaria", () => {
  it("dice cuántos clientes hay, los numera, pone el recado bajo el nombre y no deja quitar los del vendedor", () => {
    pintar();
    expect(screen.getByRole("heading", { level: 2, name: "Clientes de la ruta: 3" })).toBeInTheDocument();
    const renglones = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(renglones[0]).toContain("1Abarrotes A");
    expect(renglones[0]).toContain("Vender solo de contado");
    expect(screen.getByText("agregada por el vendedor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar Abarrotes A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar Mini M" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar Tienda B" })).toBeNull();
  });

  it("↑ en el primero y ↓ en el último están deshabilitados; ↓ mueve una posición", async () => {
    const { onMover, onQuitar } = pintar();
    const usuario = userEvent.setup();

    expect(screen.getByRole("button", { name: "Subir Abarrotes A" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar Tienda B" })).toBeDisabled();
    await usuario.click(screen.getByRole("button", { name: "Bajar Abarrotes A" }));
    expect(onMover).toHaveBeenCalledWith(0, 1);
    await usuario.click(screen.getByRole("button", { name: "Subir Tienda B" }));
    expect(onMover).toHaveBeenCalledWith(2, 1);
    await usuario.click(screen.getByRole("button", { name: "Quitar Mini M" }));
    expect(onQuitar).toHaveBeenCalledWith(1);
  });

  it("el recado se escribe en su ventana; más de 200 caracteres no se acepta", async () => {
    const { onRecado } = pintar();
    const usuario = userEvent.setup();

    await usuario.click(screen.getByRole("button", { name: "Mensaje para Mini M" }));
    const campo = await screen.findByLabelText("Mensaje");
    fireEvent.change(campo, { target: { value: "a".repeat(201) } });
    expect(screen.getByText("El mensaje no puede pasar de 200 caracteres.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar mensaje" })).toBeDisabled();

    fireEvent.change(campo, { target: { value: "SOLAMENTE COBRAR" } });
    await usuario.click(screen.getByRole("button", { name: "Guardar mensaje" }));
    expect(onRecado).toHaveBeenCalledWith(1, "SOLAMENTE COBRAR");
  });

  it("en solo lectura no hay flechas, quitar ni recado", () => {
    pintar({ editable: false });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Vender solo de contado")).toBeInTheDocument();
  });

  it("la ventana del recado se monta una vez y trae el texto de cada fila al abrirse", async () => {
    pintar();
    const usuario = userEvent.setup();

    await usuario.click(screen.getByRole("button", { name: "Mensaje para Mini M" }));
    fireEvent.change(await screen.findByLabelText("Mensaje"), { target: { value: "borrador" } });
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));

    await usuario.click(screen.getByRole("button", { name: "Mensaje para Abarrotes A" }));
    expect(await screen.findByLabelText("Mensaje")).toHaveValue("Vender solo de contado");
    expect(screen.getByText("Mensaje para Abarrotes A")).toBeInTheDocument();
  });
});

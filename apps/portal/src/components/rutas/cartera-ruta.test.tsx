import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClienteResumen } from "@/lib/clientes";
import { CarteraRuta } from "./cartera-ruta";

const c = (id: string, nombre: string): ClienteResumen => ({
  id,
  nombre,
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
});
const cartera = [c("a", "Abarrotes Doña Lupe"), c("b", "Tienda La Esquina"), c("x", "Ya en ruta")];

describe("CarteraRuta", () => {
  it("ofrece lo que no está en la ruta y filtra por nombre", async () => {
    const usuario = userEvent.setup();
    render(<CarteraRuta cartera={cartera} enRuta={new Set(["x"])} onAgregar={vi.fn()} />);

    expect(screen.queryByText("Ya en ruta")).toBeNull();
    await usuario.type(screen.getByLabelText("Buscar cliente"), "dona");
    expect(screen.getByText("Abarrotes Doña Lupe")).toBeInTheDocument();
    expect(screen.queryByText("Tienda La Esquina")).toBeNull();
  });

  it("Agregar avisa con el cliente", async () => {
    const onAgregar = vi.fn();
    const usuario = userEvent.setup();
    render(<CarteraRuta cartera={cartera} enRuta={new Set()} onAgregar={onAgregar} />);

    await usuario.click(screen.getByRole("button", { name: "Agregar Tienda La Esquina" }));
    expect(onAgregar).toHaveBeenCalledWith(cartera[1]);
  });
});

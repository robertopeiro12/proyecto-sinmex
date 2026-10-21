import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TablaCatalogo } from "./tabla-catalogo";

interface Fila {
  id: string;
  nombre: string;
  activo: boolean;
}

const FILAS: Fila[] = [
  { id: "1", nombre: "Jamaica", activo: true },
  { id: "2", nombre: "Horchata", activo: false },
];

const COLUMNAS = [
  { encabezado: "Nombre", celda: (f: Fila) => f.nombre },
  { encabezado: "Estado", celda: (f: Fila) => (f.activo ? "Activo" : "Inactivo") },
];

describe("TablaCatalogo", () => {
  it("pinta un encabezado por columna", () => {
    render(<TablaCatalogo items={FILAS} columnas={COLUMNAS} vacio="Nada." />);

    expect(screen.getByRole("columnheader", { name: "Nombre" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Estado" })).toBeInTheDocument();
  });

  it("pinta una fila por item, con la celda que define cada columna", () => {
    render(<TablaCatalogo items={FILAS} columnas={COLUMNAS} vacio="Nada." />);

    expect(screen.getByText("Jamaica")).toBeInTheDocument();
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    // +1 por la fila de encabezados.
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("muestra el mensaje de vacio cuando no hay items", () => {
    render(<TablaCatalogo items={[]} columnas={COLUMNAS} vacio="No hay productos." />);

    expect(screen.getByText("No hay productos.")).toBeInTheDocument();
  });

  it("pinta la columna de acciones solo cuando se le pasa", () => {
    const { rerender } = render(
      <TablaCatalogo items={FILAS} columnas={COLUMNAS} vacio="Nada." />,
    );
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();

    rerender(
      <TablaCatalogo
        items={FILAS}
        columnas={COLUMNAS}
        vacio="Nada."
        acciones={() => <button>Editar</button>}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(2);
  });

  it("pasa el className de la columna a su celda", () => {
    render(
      <TablaCatalogo
        items={FILAS}
        columnas={[{ encabezado: "Nombre", celda: (f: Fila) => f.nombre, className: "font-mono" }]}
        vacio="Nada."
      />,
    );

    expect(screen.getByRole("cell", { name: "Jamaica" })).toHaveClass("font-mono");
  });

  it("la columna de acciones tiene encabezado para lector de pantalla, alineado a la derecha", () => {
    render(
      <TablaCatalogo items={FILAS} columnas={COLUMNAS} vacio="Nada." acciones={() => <button>Editar</button>} />,
    );

    expect(screen.getByRole("columnheader", { name: "Acciones" })).toHaveClass("text-right");
  });

  it("el mensaje de vacio ocupa todas las columnas, contando la de acciones", () => {
    render(<TablaCatalogo items={[]} columnas={COLUMNAS} vacio="Nada." acciones={() => null} />);

    expect(screen.getByRole("cell", { name: "Nada." })).toHaveAttribute("colspan", "3");
  });
});

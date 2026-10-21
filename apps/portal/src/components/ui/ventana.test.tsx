import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Ventana } from "./ventana";

describe("Ventana", () => {
  it("abierta muestra un dialog con su título", () => {
    render(
      <Ventana abierta alCerrar={vi.fn()} titulo="Editar Jamaica">
        <p>Contenido de la ventana</p>
      </Ventana>,
    );
    expect(screen.getByRole("dialog", { name: "Editar Jamaica" })).toBeInTheDocument();
    expect(screen.getByText("Contenido de la ventana")).toBeInTheDocument();
  });

  it("cerrada no pinta nada", () => {
    render(
      <Ventana abierta={false} alCerrar={vi.fn()} titulo="Editar Jamaica">
        <p>Contenido de la ventana</p>
      </Ventana>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Esc llama a alCerrar", async () => {
    const usuario = userEvent.setup();
    const alCerrar = vi.fn();
    render(
      <Ventana abierta alCerrar={alCerrar} titulo="Editar Jamaica">
        <input aria-label="Nombre" />
      </Ventana>,
    );
    await usuario.keyboard("{Escape}");
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  it("el foco entra al primer campo", async () => {
    render(
      <Ventana abierta alCerrar={vi.fn()} titulo="Editar Jamaica">
        <input aria-label="Nombre" />
      </Ventana>,
    );
    await vi.waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveFocus());
  });
});

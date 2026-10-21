import { useState } from "react";
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

  it("al cerrar, el foco vuelve al botón que la abrió", async () => {
    const usuario = userEvent.setup();
    function Apertura() {
      const [abierta, setAbierta] = useState(false);
      return (
        <>
          <button onClick={() => setAbierta(true)}>Abrir</button>
          <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo="Editar Jamaica">
            <input aria-label="Nombre" />
          </Ventana>
        </>
      );
    }
    render(<Apertura />);
    const abridor = screen.getByRole("button", { name: "Abrir" });

    await usuario.click(abridor);
    await vi.waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveFocus());
    await usuario.keyboard("{Escape}");

    await vi.waitFor(() => expect(abridor).toHaveFocus());
  });

  it("ancho='ancho' usa la clase de la ventana ancha", () => {
    render(
      <Ventana abierta alCerrar={vi.fn()} titulo="Editar Jamaica" ancho="ancho">
        <p>Contenido</p>
      </Ventana>,
    );
    expect(screen.getByRole("dialog")).toHaveClass("w-[min(44rem,92vw)]");
  });
});

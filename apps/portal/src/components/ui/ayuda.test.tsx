import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Ayuda } from "./ayuda";

const TEXTO = "Puede consultar los gastos que registran los vendedores en la ruta, con su ticket.";

describe("Ayuda", () => {
  it("el ⓘ se nombra por su tema y no muestra el texto hasta que se le pide", () => {
    render(<Ayuda tema="Ver gastos" texto={TEXTO} />);
    expect(screen.getByRole("button", { name: "Qué permite: Ver gastos" })).toBeInTheDocument();
    expect(screen.queryByText(TEXTO)).not.toBeInTheDocument();
  });

  it("al pasar el mouse sale el globito con la explicación", async () => {
    const usuario = userEvent.setup();
    render(<Ayuda tema="Ver gastos" texto={TEXTO} />);
    await usuario.hover(screen.getByRole("button", { name: "Qué permite: Ver gastos" }));
    expect(await screen.findByText(TEXTO)).toBeInTheDocument();
  });

  it("también sale al llegar con el teclado, y Escape lo cierra", async () => {
    const usuario = userEvent.setup();
    render(<Ayuda tema="Ver gastos" texto={TEXTO} />);
    await usuario.tab();
    expect(screen.getByRole("button", { name: "Qué permite: Ver gastos" })).toHaveFocus();
    expect(await screen.findByText(TEXTO)).toBeInTheDocument();
    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText(TEXTO)).not.toBeInTheDocument());
  });
});

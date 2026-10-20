import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuscadorCliente } from "./buscador-cliente";

describe("BuscadorCliente", () => {
  it("dos buscadores a la vez: cada etiqueta apunta a su propio cuadro", () => {
    const props = { clientes: [], cliente: null, onElegir: () => {}, onQuitar: () => {} };
    const { container } = render(
      <>
        <BuscadorCliente {...props} />
        <BuscadorCliente {...props} />
      </>,
    );
    const etiquetas = Array.from(container.querySelectorAll("label"));
    const cuadros = screen.getAllByLabelText("Cliente");
    expect(etiquetas).toHaveLength(2);
    expect(cuadros).toHaveLength(2);
    expect(cuadros[0].id).not.toBe(cuadros[1].id);
    etiquetas.forEach((e, i) => expect(e.htmlFor).toBe(cuadros[i].id));
  });
});

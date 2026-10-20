import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AreaTexto, Campo, Casilla, Entrada, Lista } from "./campo";

describe("Campo", () => {
  it("la etiqueta nombra al control de adentro", () => {
    render(
      <Campo id="km-desde" etiqueta="Desde">
        <Entrada type="date" defaultValue="2026-10-01" />
      </Campo>,
    );
    const control = screen.getByLabelText("Desde");
    expect(control).toHaveAttribute("id", "km-desde");
    expect(control).toHaveValue("2026-10-01");
    expect(control).not.toHaveAttribute("aria-invalid");
  });

  it("marca (opcional) en la etiqueta", () => {
    render(
      <Campo id="comentario" etiqueta="Comentario" opcional>
        <AreaTexto />
      </Campo>,
    );
    expect(screen.getByLabelText("Comentario (opcional)").tagName).toBe("TEXTAREA");
  });

  it("ayuda y error quedan ligados al control con aria-describedby y aria-invalid", () => {
    render(
      <Campo id="monto" etiqueta="Monto" ayuda="En pesos." error="El monto debe ser mayor a $0.">
        <Entrada />
      </Campo>,
    );
    const control = screen.getByLabelText("Monto");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription("En pesos. El monto debe ser mayor a $0.");
  });

  it("lo que el control trae explícito gana", () => {
    render(
      <Campo id="uno" etiqueta="Vehículo">
        <Lista id="otro" aria-label="Vehículo propio">
          <option value="">Todos</option>
        </Lista>
      </Campo>,
    );
    expect(screen.getByRole("combobox", { name: "Vehículo propio" })).toHaveAttribute("id", "otro");
  });

  it("deshabilitado pasa al control", () => {
    render(
      <Campo id="n" etiqueta="Número">
        <Entrada disabled />
      </Campo>,
    );
    expect(screen.getByLabelText("Número")).toBeDisabled();
  });
});

describe("Entrada fuera de un Campo", () => {
  it("funciona sola con su aria-label", () => {
    render(<Entrada aria-label="Cantidad de Horchata 1 L" type="number" />);
    expect(screen.getByLabelText("Cantidad de Horchata 1 L")).toHaveAttribute("type", "number");
  });
});

describe("Casilla", () => {
  it("con etiqueta visible", () => {
    render(<Casilla etiqueta="Mostrar también las N/A" defaultChecked />);
    expect(screen.getByLabelText("Mostrar también las N/A")).toBeChecked();
  });

  it("sin etiqueta visible, con aria-label", () => {
    render(<Casilla aria-label="Marcar TJ240401OF01" />);
    expect(screen.getByRole("checkbox", { name: "Marcar TJ240401OF01" })).not.toBeChecked();
  });
});

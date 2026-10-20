import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Monto } from "./monto";

describe("Monto", () => {
  it("pesos con cifras de ancho fijo", () => {
    render(<Monto centavos={123456} />);
    const monto = screen.getByText("$1,234.56");
    expect(monto).toHaveClass("tabular-nums");
    expect(monto).not.toHaveClass("text-destructive");
  });

  it("un negativo va en rojo y con el signo antes del $", () => {
    render(<Monto centavos={-5000} />);
    expect(screen.getByText("-$50.00")).toHaveClass("text-destructive");
  });
});

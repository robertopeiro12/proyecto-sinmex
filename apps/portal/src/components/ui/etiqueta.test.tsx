import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Etiqueta, EtiquetaStatusVenta } from "./etiqueta";

describe("EtiquetaStatusVenta", () => {
  it.each([
    ["pagada", "Pagada", "exito"],
    ["pendiente", "Pendiente", "advertencia"],
    ["abonado", "Abonado", "informacion"],
    ["promocion", "Promoción", "neutro"],
    ["cuenta_perdida", "Cuenta perdida", "error"],
  ] as const)("%s dice %s en tono %s", (status, texto, tono) => {
    render(<EtiquetaStatusVenta status={status} />);
    expect(screen.getByText(texto)).toHaveAttribute("data-tono", tono);
  });
});

describe("Etiqueta", () => {
  it("sin tono es neutra", () => {
    render(<Etiqueta>Prospecto</Etiqueta>);
    expect(screen.getByText("Prospecto")).toHaveAttribute("data-tono", "neutro");
  });
});

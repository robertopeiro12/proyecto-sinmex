import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Aviso } from "./aviso";

describe("Aviso", () => {
  it("un error interrumpe al lector de pantalla (alert) y lleva su tono", () => {
    render(<Aviso tono="error">No se pudo guardar.</Aviso>);
    const aviso = screen.getByRole("alert");
    expect(aviso).toHaveTextContent("No se pudo guardar.");
    expect(aviso).toHaveAttribute("data-tono", "error");
  });

  it.each(["exito", "advertencia", "informacion"] as const)("%s espera su turno (status)", (tono) => {
    render(<Aviso tono={tono}>Listo.</Aviso>);
    expect(screen.getByRole("status")).toHaveAttribute("data-tono", tono);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

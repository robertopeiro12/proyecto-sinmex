import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EncabezadoPantalla, Pantalla } from "./encabezado-pantalla";

describe("EncabezadoPantalla", () => {
  it("título como h1, la línea que explica y el botón principal", () => {
    render(
      <Pantalla>
        <EncabezadoPantalla
          titulo="Ventas"
          descripcion="Busca una venta por fecha, cliente o # de nota para verla, editarla o eliminarla."
          acciones={<button type="button">Registrar venta</button>}
        />
      </Pantalla>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Ventas" })).toHaveClass("font-titulo");
    expect(screen.getByText(/para verla, editarla o eliminarla/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar venta" })).toBeInTheDocument();
  });

  it("sin descripción ni acciones, solo el título", () => {
    render(<EncabezadoPantalla titulo="Facturas" />);
    expect(screen.getByRole("heading", { level: 1, name: "Facturas" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

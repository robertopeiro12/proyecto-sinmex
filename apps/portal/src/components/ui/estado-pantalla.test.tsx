import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstadoPantalla, TEXTO_ESTADO_PANTALLA } from "./estado-pantalla";

describe("EstadoPantalla", () => {
  it("el mismo texto en todas las pantallas", () => {
    expect(TEXTO_ESTADO_PANTALLA).toEqual({
      cargando: "Cargando…",
      "sin-permiso": "No tienes permiso para ver esta sección.",
      "elige-sucursal": "Elige una sucursal en el menú lateral para ver esta sección.",
    });
  });

  it("con título: el encabezado de la pantalla y el texto debajo", () => {
    render(<EstadoPantalla titulo="Cobranza" tipo="sin-permiso" />);
    expect(screen.getByRole("heading", { level: 1, name: "Cobranza" })).toBeInTheDocument();
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
  });

  it("sin título: solo el texto (dentro de un panel)", () => {
    render(<EstadoPantalla tipo="cargando" />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});

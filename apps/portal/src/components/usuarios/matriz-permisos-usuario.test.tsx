import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatrizPermisosUsuario } from "./matriz-permisos-usuario";

describe("MatrizPermisosUsuario", () => {
  it("cuentas_cobrar.ver trae su explicación en lenguaje llano", () => {
    render(
      <MatrizPermisosUsuario
        catalogo={[{ id: "p1", clave: "cuentas_cobrar.ver", descripcion: "Ver cuentas por cobrar", grupo: "Operación" }]}
        marcados={new Set()}
        onCambiar={vi.fn()}
        disabled={false}
      />,
    );
    expect(
      screen.getByText("Puede ver cuánto debe cada cliente, con sus notas pendientes y vencidas (no puede cobrar)."),
    ).toBeInTheDocument();
  });
});

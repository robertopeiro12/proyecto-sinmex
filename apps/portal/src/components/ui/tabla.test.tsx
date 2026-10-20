import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CajaTabla, Fila, FilaGrupo, FilaTotal, FilaVacia, Tabla, Td, TdMonto, Th } from "./tabla";

function Ejemplo({ densidad }: { densidad?: "normal" | "compacta" }) {
  return (
    <CajaTabla altoMaximo="70vh" data-testid="caja">
      <Tabla densidad={densidad}>
        <thead>
          <tr>
            <Th>Cliente</Th>
            <Th alinear="derecha">Saldo</Th>
          </tr>
        </thead>
        <tbody>
          <FilaGrupo columnas={2}>Nissan-01</FilaGrupo>
          <Fila interactiva>
            <Td>Abarrotes Lupita</Td>
            <TdMonto centavos={-5000} />
          </Fila>
          <FilaVacia columnas={2}>Sin ventas.</FilaVacia>
          <FilaTotal>
            <Td>Total</Td>
            <TdMonto centavos={123456} />
          </FilaTotal>
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

describe("Tabla", () => {
  it("Review Focus 5: la caja se desplaza sola y no empuja la página; con alto máximo fija el encabezado", () => {
    render(<Ejemplo />);
    const caja = screen.getByTestId("caja");
    expect(caja).toHaveClass("overflow-auto");
    expect(caja.style.maxHeight).toBe("70vh");
    expect(screen.getByRole("columnheader", { name: "Cliente" })).toHaveClass("sticky");
  });

  it("encabezados con scope de columna y los montos a la derecha, sin cortar", () => {
    render(<Ejemplo />);
    expect(screen.getByRole("columnheader", { name: "Saldo" })).toHaveAttribute("scope", "col");
    expect(screen.getByRole("columnheader", { name: "Saldo" })).toHaveClass("text-right");
    const celda = screen.getByText("$1,234.56").closest("td");
    expect(celda).toHaveClass("text-right", "whitespace-nowrap");
    expect(screen.getByText("-$50.00")).toHaveClass("text-destructive");
  });

  it("densidad compacta queda en la tabla; normal por defecto", () => {
    const { unmount } = render(<Ejemplo />);
    expect(screen.getByRole("table")).toHaveAttribute("data-densidad", "normal");
    unmount();
    render(<Ejemplo densidad="compacta" />);
    expect(screen.getByRole("table")).toHaveAttribute("data-densidad", "compacta");
  });

  it("fila de grupo, fila vacía y fila de total", () => {
    render(<Ejemplo />);
    expect(screen.getByText("Nissan-01", { selector: "th" })).toHaveAttribute("scope", "rowgroup");
    expect(screen.getByText("Nissan-01", { selector: "th" })).toHaveAttribute("colSpan", "2");
    expect(screen.getByText("Sin ventas.")).toHaveAttribute("colSpan", "2");
    expect(screen.getByText("Total").closest("tr")).toHaveClass("font-semibold");
    expect(screen.getByText("Abarrotes Lupita").closest("tr")).toHaveClass("hover:bg-menu");
  });
});

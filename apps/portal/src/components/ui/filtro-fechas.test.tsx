import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { RangoFechas } from "@/lib/fechas";
import { FiltroFechas, MENSAJE_RANGO_INVERTIDO } from "./filtro-fechas";

// "Hoy" fijo en un domingo 1 de noviembre: "Esta semana" cruza de mes y "Ayer" también.
vi.mock("@/lib/ventas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ventas")>()),
  hoyEnTijuana: () => "2026-11-01",
}));

function Prueba({ onMostrar, deshabilitado = false }: { onMostrar: (r: RangoFechas) => void; deshabilitado?: boolean }) {
  const [rango, setRango] = useState<RangoFechas>({ desde: "2026-10-01", hasta: "2026-10-15" });
  return (
    <FiltroFechas
      id="prueba"
      desde={rango.desde}
      hasta={rango.hasta}
      onCambio={setRango}
      onMostrar={onMostrar}
      deshabilitado={deshabilitado}
      acciones={<button type="button">Exportar a Excel</button>}
    >
      <label>
        Vehículo
        <select defaultValue="">
          <option value="">Todos</option>
        </select>
      </label>
    </FiltroFechas>
  );
}

describe("FiltroFechas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Desde, Hasta, los filtros de la pantalla, Mostrar y Excel", () => {
    render(<Prueba onMostrar={vi.fn()} />);
    expect(screen.getByLabelText("Desde")).toHaveAttribute("id", "prueba-desde");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-10-15");
    expect(screen.getByLabelText("Vehículo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeInTheDocument();
  });

  it.each([
    ["Hoy", "2026-11-01", "2026-11-01"],
    ["Ayer", "2026-10-31", "2026-10-31"],
    ["Esta semana", "2026-10-26", "2026-11-01"],
    ["Este mes", "2026-11-01", "2026-11-30"],
  ])("el atajo %s pone %s a %s sin consultar", async (atajo, desde, hasta) => {
    const usuario = userEvent.setup();
    const onMostrar = vi.fn();
    render(<Prueba onMostrar={onMostrar} />);
    await usuario.click(screen.getByRole("button", { name: atajo }));
    expect(screen.getByLabelText("Desde")).toHaveValue(desde);
    expect(screen.getByLabelText("Hasta")).toHaveValue(hasta);
    expect(onMostrar).not.toHaveBeenCalled();
  });

  it("Mostrar entrega el rango", async () => {
    const usuario = userEvent.setup();
    const onMostrar = vi.fn();
    render(<Prueba onMostrar={onMostrar} />);
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(onMostrar).toHaveBeenCalledWith({ desde: "2026-10-01", hasta: "2026-10-15" });
  });

  it("con fechas invertidas avisa y no consulta; un atajo quita el aviso", async () => {
    const usuario = userEvent.setup();
    const onMostrar = vi.fn();
    render(<Prueba onMostrar={onMostrar} />);
    // Un <input type="date"> en jsdom se cambia con un evento, no tecleando.
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-12-31" } });
    await usuario.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent(MENSAJE_RANGO_INVERTIDO);
    expect(onMostrar).not.toHaveBeenCalled();
    await usuario.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("deshabilitado apaga Mostrar", () => {
    render(<Prueba onMostrar={vi.fn()} deshabilitado />);
    expect(screen.getByRole("button", { name: "Mostrar" })).toBeDisabled();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pestanas } from "./pestanas";

const PESTANAS = [
  { valor: "asignar", etiqueta: "Asignar", contenido: <input aria-label="Marcado" defaultValue="lo que escribí" /> },
  { valor: "buscar", etiqueta: "Buscar y corregir", contenido: <p>Panel de búsqueda</p> },
];

describe("Pestanas", () => {
  it("abre en la primera, ligada a su panel", () => {
    render(<Pestanas etiqueta="Facturas" pestanas={PESTANAS} />);
    expect(screen.getByRole("tablist", { name: "Facturas" })).toBeInTheDocument();
    const asignar = screen.getByRole("tab", { name: "Asignar" });
    expect(asignar).toHaveAttribute("aria-selected", "true");
    const panel = document.getElementById(asignar.getAttribute("aria-controls") ?? "");
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", asignar.id);
    expect(screen.queryByText("Panel de búsqueda")).not.toBeInTheDocument();
  });

  it("valorInicial elige otra", () => {
    render(<Pestanas pestanas={PESTANAS} valorInicial="buscar" />);
    expect(screen.getByRole("tab", { name: "Buscar y corregir" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Panel de búsqueda")).toBeInTheDocument();
  });

  it("las flechas cambian de pestaña y mueven el foco", async () => {
    const usuario = userEvent.setup();
    render(<Pestanas pestanas={PESTANAS} />);
    screen.getByRole("tab", { name: "Asignar" }).focus();
    await usuario.keyboard("{ArrowRight}");
    const buscar = screen.getByRole("tab", { name: "Buscar y corregir" });
    expect(buscar).toHaveAttribute("aria-selected", "true");
    expect(buscar).toHaveFocus();
    await usuario.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Asignar" })).toHaveAttribute("aria-selected", "true");
  });

  it("sin conservarMontadas, la otra pestaña se desmonta (empieza limpia al volver)", async () => {
    const usuario = userEvent.setup();
    render(<Pestanas pestanas={PESTANAS} />);
    await usuario.clear(screen.getByLabelText("Marcado"));
    await usuario.type(screen.getByLabelText("Marcado"), "nuevo");
    await usuario.click(screen.getByRole("tab", { name: "Buscar y corregir" }));
    expect(screen.queryByLabelText("Marcado")).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("tab", { name: "Asignar" }));
    expect(screen.getByLabelText("Marcado")).toHaveValue("lo que escribí");
  });

  it("con conservarMontadas, la otra queda oculta pero no se pierde lo escrito", async () => {
    const usuario = userEvent.setup();
    render(<Pestanas pestanas={PESTANAS} conservarMontadas />);
    await usuario.clear(screen.getByLabelText("Marcado"));
    await usuario.type(screen.getByLabelText("Marcado"), "nuevo");
    const asignar = screen.getByRole("tab", { name: "Asignar" });
    await usuario.click(screen.getByRole("tab", { name: "Buscar y corregir" }));
    expect(document.getElementById(asignar.getAttribute("aria-controls") ?? "")).toHaveAttribute("hidden");
    await usuario.click(asignar);
    expect(screen.getByLabelText("Marcado")).toHaveValue("nuevo");
  });
});

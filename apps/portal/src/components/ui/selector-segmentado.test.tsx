import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectorSegmentado } from "./selector-segmentado";

const OPCIONES = [
  { valor: "producto" as const, texto: "Por producto" },
  { valor: "cliente" as const, texto: "Por cliente" },
];

describe("SelectorSegmentado", () => {
  it("marca la elegida y solo ella es tabulable", () => {
    render(<SelectorSegmentado etiqueta="Agrupar" opciones={OPCIONES} valor="producto" onCambio={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Agrupar" })).toBeInTheDocument();
    const producto = screen.getByRole("radio", { name: "Por producto" });
    const cliente = screen.getByRole("radio", { name: "Por cliente" });
    expect(producto).toHaveAttribute("aria-checked", "true");
    expect(cliente).toHaveAttribute("aria-checked", "false");
    expect(producto).toHaveAttribute("tabindex", "0");
    expect(cliente).toHaveAttribute("tabindex", "-1");
  });

  it("picar la otra avisa su valor", async () => {
    const onCambio = vi.fn();
    render(<SelectorSegmentado etiqueta="Agrupar" opciones={OPCIONES} valor="producto" onCambio={onCambio} />);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Por cliente" }));
    expect(onCambio).toHaveBeenCalledWith("cliente");
  });

  it("las flechas cambian la elegida, dando la vuelta", async () => {
    const usuario = userEvent.setup();
    const onCambio = vi.fn();
    const { rerender } = render(
      <SelectorSegmentado etiqueta="Agrupar" opciones={OPCIONES} valor="producto" onCambio={onCambio} />,
    );
    screen.getByRole("radio", { name: "Por producto" }).focus();
    await usuario.keyboard("{ArrowRight}");
    expect(onCambio).toHaveBeenLastCalledWith("cliente");
    await usuario.keyboard("{ArrowLeft}"); // el foco ya está en "cliente"
    expect(onCambio).toHaveBeenLastCalledWith("producto");
    await usuario.keyboard("{ArrowLeft}"); // desde "producto", atrás da la vuelta
    expect(onCambio).toHaveBeenLastCalledWith("cliente");
    rerender(<SelectorSegmentado etiqueta="Agrupar" opciones={OPCIONES} valor="cliente" onCambio={onCambio} />);
    screen.getByRole("radio", { name: "Por cliente" }).focus();
    await usuario.keyboard("{ArrowRight}");
    expect(onCambio).toHaveBeenLastCalledWith("producto");
  });

  it("si el valor no coincide con ninguna, la primera es tabulable", () => {
    render(<SelectorSegmentado etiqueta="Agrupar" opciones={OPCIONES} valor={"otro" as "producto"} onCambio={() => {}} />);
    expect(screen.getByRole("radio", { name: "Por producto" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Por cliente" })).toHaveAttribute("tabindex", "-1");
  });
});

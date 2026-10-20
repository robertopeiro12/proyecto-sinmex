import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BotonExcel } from "./boton-excel";

describe("BotonExcel", () => {
  it("Exportar a Excel llama a onClick", async () => {
    const onClick = vi.fn();
    render(<BotonExcel exportando={false} onClick={onClick} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Exportar a Excel" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("mientras exporta dice Exportando… y no se deja picar", () => {
    render(<BotonExcel exportando onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Exportando…" })).toBeDisabled();
  });

  it("sin nada que exportar está apagado", () => {
    render(<BotonExcel exportando={false} disabled onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Exportar a Excel" })).toBeDisabled();
  });
});

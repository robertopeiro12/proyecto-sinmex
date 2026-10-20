import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CLAVE_SECCIONES, SeccionesMenu } from "./secciones-menu";

describe("SeccionesMenu", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("abre sola la sección de la pantalla actual y marca su opción", () => {
    render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    expect(screen.getByRole("navigation", { name: "Menú principal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Operación" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Finanzas" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Ventas" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Facturas" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: "Tesorería" })).not.toBeInTheDocument();
  });

  it("una pantalla dentro de Reportes abre Información y marca Reportes", () => {
    render(<SeccionesMenu pathname="/informacion/reportes/kilometraje" sucursal={null} />);
    expect(screen.getByRole("button", { name: "Información" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Reportes" })).toHaveAttribute("aria-current", "page");
  });

  it("los enlaces conservan la sucursal elegida", () => {
    render(<SeccionesMenu pathname="/operacion/ventas" sucursal="TJ" />);
    expect(screen.getByRole("link", { name: "Cobranza" })).toHaveAttribute("href", "/operacion/cobranza?sucursal=TJ");
  });

  it("lo que todavía no existe dice Pronto; lo que existe no", () => {
    render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    const rutaSemanal = screen.getByRole("link", { name: "Ruta Semanal Pronto" });
    expect(within(rutaSemanal).getByText("Pronto")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: "Ventas" })).queryByText("Pronto")).not.toBeInTheDocument();
  });

  it("recuerda lo que el usuario abre y cierra", async () => {
    const usuario = userEvent.setup();
    const { unmount } = render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    await usuario.click(screen.getByRole("button", { name: "Finanzas" }));
    expect(screen.getByRole("button", { name: "Finanzas" })).toHaveAttribute("aria-expanded", "true");
    expect(JSON.parse(localStorage.getItem(CLAVE_SECCIONES) ?? "{}")).toMatchObject({ Finanzas: true });
    unmount();

    render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Finanzas" })).toHaveAttribute("aria-expanded", "true"));
  });

  it("la sección actual se abre aunque se haya guardado cerrada", async () => {
    localStorage.setItem(CLAVE_SECCIONES, JSON.stringify({ "Operación": false, "Catálogo": true }));
    render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Catálogo" })).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByRole("button", { name: "Operación" })).toHaveAttribute("aria-expanded", "true");
  });

  it("Review Focus 2: con basura guardada arranca solo con la sección actual", async () => {
    localStorage.setItem(CLAVE_SECCIONES, "{no es json");
    render(<SeccionesMenu pathname="/finanzas/tesoreria" sucursal={null} />);
    expect(screen.getByRole("button", { name: "Finanzas" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Operación" })).toHaveAttribute("aria-expanded", "false");
  });

  it("Review Focus 2: sin localStorage se puede abrir y cerrar igual", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const usuario = userEvent.setup();
    render(<SeccionesMenu pathname="/operacion/ventas" sucursal={null} />);
    expect(screen.getByRole("button", { name: "Operación" })).toHaveAttribute("aria-expanded", "true");
    await usuario.click(screen.getByRole("button", { name: "Catálogo" }));
    expect(screen.getByRole("button", { name: "Catálogo" })).toHaveAttribute("aria-expanded", "true");
    await usuario.click(screen.getByRole("button", { name: "Operación" }));
    expect(screen.getByRole("button", { name: "Operación" })).toHaveAttribute("aria-expanded", "false");
  });
});

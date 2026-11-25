import { describe, expect, it, vi } from "vitest";
import Page from "./page";

vi.mock("@/components/procesos/pantalla-procesos", () => ({ PantallaProcesos: () => null }));

describe("/operacion/procesos", () => {
  it("pasa pestana, cliente y nota a la pantalla", async () => {
    const el = await Page({ searchParams: Promise.resolve({ sucursal: "TJ", pestana: "notas", cliente: "c1", nota: "n1" }) });
    expect(el.props).toMatchObject({ sucursal: "TJ", pestanaInicial: "notas", clienteInicial: "c1", notaInicial: "n1" });
  });

  it("sin parámetros, todo nulo", async () => {
    const el = await Page({ searchParams: Promise.resolve({}) });
    expect(el.props).toMatchObject({ sucursal: null, pestanaInicial: null, clienteInicial: null, notaInicial: null });
  });
});

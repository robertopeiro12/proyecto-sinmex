import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import Page from "./page";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("/produccion/recarga", () => {
  beforeEach(() => vi.mocked(redirect).mockReset());

  it("lleva a Recargas del Registro de Operación conservando la sucursal", async () => {
    await Page({ searchParams: Promise.resolve({ sucursal: "MX" }) });
    expect(redirect).toHaveBeenCalledWith("/produccion/registro-operacion?pestana=recarga&sucursal=MX");
  });

  it("sin sucursal, solo la pestaña", async () => {
    await Page({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith("/produccion/registro-operacion?pestana=recarga");
  });
});

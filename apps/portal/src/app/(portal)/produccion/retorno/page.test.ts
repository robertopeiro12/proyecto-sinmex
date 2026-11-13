import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import Page from "./page";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("/produccion/retorno", () => {
  beforeEach(() => vi.mocked(redirect).mockReset());

  it("lleva al Corte conservando la sucursal elegida", async () => {
    await Page({ searchParams: Promise.resolve({ sucursal: "MX" }) });
    expect(redirect).toHaveBeenCalledWith("/produccion/corte?sucursal=MX");
  });

  it("sin sucursal lleva al Corte sin query", async () => {
    await Page({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith("/produccion/corte");
  });
});

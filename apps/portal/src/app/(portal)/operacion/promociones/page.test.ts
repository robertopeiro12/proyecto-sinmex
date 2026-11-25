import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import Page from "./page";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("/operacion/promociones", () => {
  beforeEach(() => vi.mocked(redirect).mockReset());

  it("lleva a Catálogo › Promociones conservando la sucursal", async () => {
    await Page({ searchParams: Promise.resolve({ sucursal: "MX" }) });
    expect(redirect).toHaveBeenCalledWith("/catalogo/promociones?sucursal=MX");
  });

  it("sin sucursal, solo la dirección nueva", async () => {
    await Page({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith("/catalogo/promociones");
  });
});

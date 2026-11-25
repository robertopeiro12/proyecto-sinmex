import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import Page from "./page";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("/operacion/ventas", () => {
  beforeEach(() => vi.mocked(redirect).mockReset());

  it("lleva a Procesos, pestaña notas, conservando la sucursal", async () => {
    await Page({ searchParams: Promise.resolve({ sucursal: "MX" }) });
    expect(redirect).toHaveBeenCalledWith("/operacion/procesos?pestana=notas&sucursal=MX");
  });

  it("sin sucursal, solo la pestaña", async () => {
    await Page({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith("/operacion/procesos?pestana=notas");
  });
});

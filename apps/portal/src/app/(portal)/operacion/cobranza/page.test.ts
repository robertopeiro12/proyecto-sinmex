import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import Page from "./page";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("/operacion/cobranza", () => {
  beforeEach(() => vi.mocked(redirect).mockReset());

  it("lleva a Notas con cliente, nota y sucursal", async () => {
    await Page({ searchParams: Promise.resolve({ sucursal: "TJ", cliente: "c1", nota: "n1" }) });
    expect(redirect).toHaveBeenCalledWith("/operacion/procesos?pestana=notas&cliente=c1&nota=n1&sucursal=TJ");
  });

  it("sin nada, solo la pestaña", async () => {
    await Page({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith("/operacion/procesos?pestana=notas");
  });

  it("solo con cliente", async () => {
    await Page({ searchParams: Promise.resolve({ cliente: "c1" }) });
    expect(redirect).toHaveBeenCalledWith("/operacion/procesos?pestana=notas&cliente=c1");
  });
});

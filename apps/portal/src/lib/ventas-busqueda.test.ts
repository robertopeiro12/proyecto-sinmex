import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { buscarVentas } from "./ventas";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

describe("buscarVentas (Procesos PR B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue({ ventas: [], hayMas: false });
  });

  it("lo de siempre: fechas, sucursal, cliente y # de nota", async () => {
    await buscarVentas({ desde: "2026-11-01", hasta: "2026-11-25", sucursal: "TJ", clienteId: "c1", numNota: " 77 " });
    expect(apiFetch).toHaveBeenCalledWith("/ventas?desde=2026-11-01&hasta=2026-11-25&sucursal=TJ&clienteId=c1&numNota=77");
  });

  it("con_saldo sin fechas, y folio con filtro", async () => {
    await buscarVentas({ sucursal: "TJ", clienteId: "c1", filtro: "con_saldo" });
    expect(apiFetch).toHaveBeenLastCalledWith("/ventas?sucursal=TJ&clienteId=c1&filtro=con_saldo");
    await buscarVentas({ sucursal: null, filtro: "todas", folio: " TJ261124RI03 " });
    expect(apiFetch).toHaveBeenLastCalledWith("/ventas?folio=TJ261124RI03&filtro=todas");
  });
});

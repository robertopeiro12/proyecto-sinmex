import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  asignarFactura,
  buscarFacturas,
  listarPorFacturar,
  quitarDeFactura,
  renombrarFactura,
  totalSeleccionado,
} from "./facturas";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

describe("lib/facturas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue([]);
  });

  it("arma las rutas y los cuerpos", async () => {
    await listarPorFacturar("c1", true);
    expect(apiFetch).toHaveBeenCalledWith("/facturas/por-facturar?clienteId=c1&incluirNA=true");
    await asignarFactura("c1", "A780", ["v1", "v2"]);
    expect(apiFetch).toHaveBeenCalledWith("/facturas/asignar", {
      method: "POST",
      body: JSON.stringify({ clienteId: "c1", numero: "A780", ventaIds: ["v1", "v2"] }),
    });
    await buscarFacturas({ numero: " A780 ", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenCalledWith("/facturas?numero=A780&sucursal=TJ");
    await renombrarFactura("f1", "A781");
    expect(apiFetch).toHaveBeenCalledWith("/facturas/f1", {
      method: "PATCH",
      body: JSON.stringify({ numero: "A781" }),
    });
    await quitarDeFactura("f1", ["v1"]);
    expect(apiFetch).toHaveBeenCalledWith("/facturas/f1/quitar", {
      method: "POST",
      body: JSON.stringify({ ventaIds: ["v1"] }),
    });
  });

  it("suma solo lo seleccionado", () => {
    const ventas = [
      { id: "v1", folio: "A", fecha: "2024-04-01", numNota: null, montoCentavos: 1000, status: "pendiente" as const },
      { id: "v2", folio: "B", fecha: "2024-04-02", numNota: null, montoCentavos: 550, status: "pendiente" as const },
    ];
    expect(totalSeleccionado(ventas, new Set(["v2"]))).toBe(550);
  });
});

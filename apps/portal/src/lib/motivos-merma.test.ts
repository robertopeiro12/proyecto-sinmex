import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import { crearMotivoMerma, editarMotivoMerma, eliminarMotivoMerma, listarMotivosMerma } from "./motivos-merma";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

describe("motivos-merma", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listar, con o sin el filtro de almacén", async () => {
    await listarMotivosMerma();
    expect(apiFetch).toHaveBeenCalledWith("/motivos-merma");
    await listarMotivosMerma("almacen");
    expect(apiFetch).toHaveBeenLastCalledWith("/motivos-merma?aplica=almacen");
  });

  it("crear, editar y eliminar", async () => {
    const datos = { nombre: "Roto", aplicaAlmacen: true, aplicaCliente: false, aplicaVehiculo: false };
    await crearMotivoMerma(datos);
    expect(apiFetch).toHaveBeenCalledWith("/motivos-merma", { method: "POST", body: JSON.stringify(datos) });
    await editarMotivoMerma("m1", { nombre: "Rotos" });
    expect(apiFetch).toHaveBeenCalledWith("/motivos-merma/m1", { method: "PATCH", body: JSON.stringify({ nombre: "Rotos" }) });
    await eliminarMotivoMerma("m1");
    expect(apiFetch).toHaveBeenLastCalledWith("/motivos-merma/m1", { method: "DELETE" });
  });
});

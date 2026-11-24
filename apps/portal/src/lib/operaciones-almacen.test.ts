import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiFetchSinCuerpo } from "./api";
import {
  crearOperacion,
  editarOperacion,
  eliminarOperacion,
  infoDeTipo,
  listarOperaciones,
  TIPOS_OPERACION,
} from "./operaciones-almacen";

vi.mock("./api", () => ({ apiFetch: vi.fn(), apiFetchSinCuerpo: vi.fn() }));

describe("operaciones-almacen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("los seis tipos con su etiqueta y su permiso", () => {
    expect(TIPOS_OPERACION.map((t) => [t.tipo, t.etiqueta, t.permiso])).toEqual([
      ["entrada", "Entradas/Compras", "operacion.entrada"],
      ["envio", "Envíos", "operacion.envio"],
      ["merma", "Merma", "operacion.merma"],
      ["consumo", "Consumo", "operacion.consumo"],
      ["descuento", "Descuentos", "operacion.descuento"],
      ["retiro_merma", "Retiro de merma", "operacion.retiro_merma"],
    ]);
    expect(infoDeTipo("envio").etiqueta).toBe("Envíos");
  });

  it("listar manda fecha, tipo y sucursal (si hay)", async () => {
    await listarOperaciones({ fecha: "2026-11-24", tipo: "entrada", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenCalledWith("/operaciones-almacen?fecha=2026-11-24&tipo=entrada&sucursal=TJ");
    await listarOperaciones({ fecha: "2026-11-24", tipo: "merma" });
    expect(apiFetch).toHaveBeenLastCalledWith("/operaciones-almacen?fecha=2026-11-24&tipo=merma");
  });

  it("crear hace POST con el cuerpo", async () => {
    const datos = {
      tipo: "consumo" as const,
      sucursal: "TJ",
      fecha: "2026-11-24",
      lineas: [{ presentacionId: "p1", piezas: 3 }],
    };
    await crearOperacion(datos);
    expect(apiFetch).toHaveBeenCalledWith("/operaciones-almacen", { method: "POST", body: JSON.stringify(datos) });
  });

  it("editar hace PUT y eliminar DELETE sin cuerpo de respuesta", async () => {
    const datos = { fecha: "2026-11-24", lineas: [{ presentacionId: "p1", piezas: 3 }] };
    await editarOperacion("o1", datos);
    expect(apiFetch).toHaveBeenCalledWith("/operaciones-almacen/o1", { method: "PUT", body: JSON.stringify(datos) });
    await eliminarOperacion("o1");
    expect(apiFetchSinCuerpo).toHaveBeenCalledWith("/operaciones-almacen/o1", { method: "DELETE" });
  });
});

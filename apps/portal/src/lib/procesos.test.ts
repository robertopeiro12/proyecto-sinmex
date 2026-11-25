import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiFetchSinCuerpo } from "./api";
import {
  crearProceso,
  cuadre,
  editarProceso,
  eliminarProceso,
  infoDeProceso,
  listarProcesos,
  llevaCliente,
  precargaDescuentos,
  resumenCliente,
  TIPOS_PROCESO,
} from "./procesos";

vi.mock("./api", () => ({ apiFetch: vi.fn(), apiFetchSinCuerpo: vi.fn() }));

const r = (piezas: number) => ({ sentido: "recibido" as const, piezas });
const e = (piezas: number) => ({ sentido: "entregado" as const, piezas });

describe("cuadre", () => {
  it("cuadra cuando lo entregado es igual a lo recibido", () => {
    expect(cuadre([r(5), e(3), e(2)])).toEqual({
      recibido: 5,
      entregado: 5,
      cuadra: true,
      texto: "Recibió 5 · entregó 5 ✓",
    });
  });

  it("dice cuántas faltan", () => {
    expect(cuadre([r(2), r(3), e(3)])).toEqual({
      recibido: 5,
      entregado: 3,
      cuadra: false,
      texto: "Recibió 5 · entregó 3 — faltan 2",
    });
  });

  it("dice cuántas sobran", () => {
    expect(cuadre([r(5), e(7)])).toEqual({
      recibido: 5,
      entregado: 7,
      cuadra: false,
      texto: "Recibió 5 · entregó 7 — sobran 2",
    });
  });
});

describe("procesos (tipos y reglas)", () => {
  it("las cinco pestañas con su etiqueta y su permiso", () => {
    expect(TIPOS_PROCESO.map((t) => [t.tipo, t.etiqueta, t.permiso])).toEqual([
      ["merma", "Merma", "proceso.merma"],
      ["cambio", "Cambios", "proceso.cambio"],
      ["consumo", "Consumos", "proceso.consumo"],
      ["promocion", "Promoción", "proceso.promocion"],
      ["descuento", "Descuentos", "proceso.descuento"],
    ]);
    expect(infoDeProceso("promocion").guardar).toBe("Guardar promoción");
  });

  it("qué tipos llevan cliente", () => {
    expect(llevaCliente("merma", "cliente")).toBe(true);
    expect(llevaCliente("merma", "almacen")).toBe(false);
    expect(llevaCliente("cambio", null)).toBe(true);
    expect(llevaCliente("promocion", null)).toBe(true);
    expect(llevaCliente("consumo", null)).toBe(false);
    expect(llevaCliente("descuento", null)).toBe(false);
  });
});

describe("procesos (API)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listar manda tipo, fecha, sucursal y el cliente si hay", async () => {
    await listarProcesos({ tipo: "merma", fecha: "2026-11-24", sucursal: "TJ", cliente: "c1" });
    expect(apiFetch).toHaveBeenCalledWith("/procesos?tipo=merma&fecha=2026-11-24&sucursal=TJ&cliente=c1");
    await listarProcesos({ tipo: "consumo", fecha: "2026-11-24", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenLastCalledWith("/procesos?tipo=consumo&fecha=2026-11-24&sucursal=TJ");
  });

  it("crear, editar y eliminar", async () => {
    const datos = {
      fecha: "2026-11-24",
      clienteId: null,
      vendedorId: null,
      mermaDe: null,
      comentario: null,
      lineas: [{ presentacionId: "p1", sentido: "entregado" as const, piezas: 2 }],
    };
    await crearProceso({ ...datos, tipo: "consumo", sucursal: "TJ" });
    expect(apiFetch).toHaveBeenCalledWith("/procesos", {
      method: "POST",
      body: JSON.stringify({ ...datos, tipo: "consumo", sucursal: "TJ" }),
    });
    await editarProceso("x1", datos);
    expect(apiFetch).toHaveBeenLastCalledWith("/procesos/x1", { method: "PATCH", body: JSON.stringify(datos) });
    await eliminarProceso("x1");
    expect(apiFetchSinCuerpo).toHaveBeenCalledWith("/procesos/x1", { method: "DELETE" });
  });

  it("precarga y resumen del cliente", async () => {
    await precargaDescuentos("v1", "2026-11-24");
    expect(apiFetch).toHaveBeenCalledWith("/procesos/descuentos/precarga?vendedor=v1&fecha=2026-11-24");
    await resumenCliente("c1");
    expect(apiFetch).toHaveBeenLastCalledWith("/procesos/cliente/c1");
  });
});

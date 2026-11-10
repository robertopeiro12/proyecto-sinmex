import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import {
  crearRutaSemanal,
  diaDeHoy,
  eliminarRutaSemanal,
  guardarClientesRutaSemanal,
  listarRutasSemanales,
  obtenerRutaSemanal,
  renombrarRutaSemanal,
  rutasDelDia,
  type RutaSemanalResumen,
} from "./rutas-semanales";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn(), apiFetchSinCuerpo: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);
const sinCuerpo = vi.mocked(api.apiFetchSinCuerpo);

const ruta = (id: string, diaSemana: number): RutaSemanalResumen => ({
  id,
  diaSemana,
  nombre: `Ruta ${id}`,
  clientes: 0,
  sucursalCodigo: "TJ",
});

describe("lib/rutas-semanales", () => {
  beforeEach(() => vi.clearAllMocks());

  it("diaDeHoy: lunes a sábado tal cual y el domingo cuenta como lunes", () => {
    expect(diaDeHoy("2026-11-09")).toBe(1); // lunes
    expect(diaDeHoy("2026-11-11")).toBe(3); // miércoles
    expect(diaDeHoy("2026-11-14")).toBe(6); // sábado
    expect(diaDeHoy("2026-11-15")).toBe(1); // domingo
  });

  it("rutasDelDia filtra por día de la semana", () => {
    const rutas = [ruta("a", 1), ruta("b", 2), ruta("c", 1)];
    expect(rutasDelDia(rutas, 1).map((r) => r.id)).toEqual(["a", "c"]);
    expect(rutasDelDia(rutas, 5)).toEqual([]);
  });

  it("listar manda la sucursal (o nada)", async () => {
    apiFetch.mockResolvedValue([]);
    await listarRutasSemanales("TJ");
    expect(apiFetch).toHaveBeenCalledWith("/rutas/semanales?sucursal=TJ");
    await listarRutasSemanales(null);
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/semanales");
  });

  it("crear, obtener, renombrar, guardar clientes y eliminar pegan donde toca", async () => {
    apiFetch.mockResolvedValue({});
    await crearRutaSemanal({ sucursal: "TJ", diaSemana: 2, nombre: "Centro" });
    expect(apiFetch).toHaveBeenCalledWith("/rutas/semanales", {
      method: "POST",
      body: JSON.stringify({ sucursal: "TJ", diaSemana: 2, nombre: "Centro" }),
    });
    await obtenerRutaSemanal("r1");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/semanales/r1");
    await renombrarRutaSemanal("r1", "Nueva");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/semanales/r1", {
      method: "PATCH",
      body: JSON.stringify({ nombre: "Nueva" }),
    });
    await guardarClientesRutaSemanal("r1", ["a", "b"]);
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/semanales/r1/clientes", {
      method: "PUT",
      body: JSON.stringify({ clientes: ["a", "b"] }),
    });
    await eliminarRutaSemanal("r1");
    expect(sinCuerpo).toHaveBeenCalledWith("/rutas/semanales/r1", { method: "DELETE" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import type { ClienteResumen } from "./clientes";
import {
  aEditables,
  agregarFila,
  armadaPorElVendedor,
  cargarAnterior,
  filtrarCartera,
  guardarRutaDiaria,
  hayCambios,
  moverFila,
  obtenerRutaAnterior,
  obtenerRutaDiaria,
  quitarFila,
  type FilaEditable,
} from "./rutas";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);

const fila = (clienteId: string, origen: "oficina" | "vendedor" = "oficina"): FilaEditable => ({
  clienteId,
  clienteNombre: `Cliente ${clienteId}`,
  origen,
});

const cliente = (id: string, nombre: string): ClienteResumen => ({
  id,
  nombre,
  telefono: "664",
  tipo: "cliente",
  tipoNegocio: null,
  sucursalCodigo: "TJ",
});

describe("lib/rutas: API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue({});
  });

  it("obtenerRutaDiaria y obtenerRutaAnterior piden por vendedor y fecha", async () => {
    await obtenerRutaDiaria("v1", "2026-10-12");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria?vendedorId=v1&fecha=2026-10-12");
    await obtenerRutaAnterior("v1", "2026-10-12");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria/anterior?vendedorId=v1&fecha=2026-10-12");
  });

  it("guardarRutaDiaria hace PUT con la lista completa", async () => {
    const cuerpo = { vendedorId: "v1", fecha: "2026-10-12", clientes: ["a", "b"] };
    await guardarRutaDiaria(cuerpo);
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria", {
      method: "PUT",
      body: JSON.stringify(cuerpo),
    });
  });
});

describe("lib/rutas: edición local (D17)", () => {
  it("aEditables se queda con cliente, nombre y origen, en orden", () => {
    expect(
      aEditables({
        vendedor: { id: "v1", nombre: "Abraham", sucursalCodigo: "TJ" },
        fecha: "2026-10-12",
        filas: [
          { id: "r1", clienteId: "a", clienteNombre: "Cliente a", orden: 1, origen: "oficina" },
          { id: "r2", clienteId: "b", clienteNombre: "Cliente b", orden: 2, origen: "vendedor" },
        ],
      }),
    ).toEqual([fila("a"), fila("b", "vendedor")]);
  });

  it("moverFila sube y baja; fuera de rango no cambia nada", () => {
    const filas = [fila("a"), fila("b"), fila("c")];
    expect(moverFila(filas, 2, 1).map((f) => f.clienteId)).toEqual(["a", "c", "b"]);
    expect(moverFila(filas, 0, 1).map((f) => f.clienteId)).toEqual(["b", "a", "c"]);
    expect(moverFila(filas, 0, -1)).toBe(filas);
    expect(moverFila(filas, 2, 3)).toBe(filas);
  });

  it("quitarFila quita una de la oficina y nunca una del vendedor (D14)", () => {
    const filas = [fila("a"), fila("b", "vendedor")];
    expect(quitarFila(filas, 0).map((f) => f.clienteId)).toEqual(["b"]);
    expect(quitarFila(filas, 1)).toBe(filas);
  });

  it("agregarFila agrega al final como de la oficina y no repite", () => {
    const filas = [fila("a")];
    expect(agregarFila(filas, { id: "b", nombre: "Cliente b" })).toEqual([fila("a"), fila("b")]);
    expect(agregarFila(filas, { id: "a", nombre: "Cliente a" })).toBe(filas);
  });

  it("cargarAnterior pone la ruta copiada, deja al final las del vendedor y omite clientes que ya no están", () => {
    const actuales = [fila("x"), fila("v", "vendedor"), fila("w", "vendedor")];
    const cartera = [cliente("a", "Cliente a"), cliente("b", "Cliente b"), cliente("w", "Cliente w")];

    expect(cargarAnterior(actuales, ["b", "w", "borrado", "a"], cartera)).toEqual([
      fila("b"),
      fila("w", "vendedor"),
      fila("a"),
      fila("v", "vendedor"),
    ]);
  });

  it("hayCambios compara el orden de los clientes", () => {
    const filas = [fila("a"), fila("b")];
    expect(hayCambios(filas, [fila("a"), fila("b")])).toBe(false);
    expect(hayCambios(filas, [fila("b"), fila("a")])).toBe(true);
    expect(hayCambios(filas, [fila("a")])).toBe(true);
  });

  it("armadaPorElVendedor solo si hay filas y todas son del vendedor (D3)", () => {
    expect(armadaPorElVendedor([])).toBe(false);
    expect(armadaPorElVendedor([fila("a", "vendedor")])).toBe(true);
    expect(armadaPorElVendedor([fila("a", "vendedor"), fila("b")])).toBe(false);
  });

  it("filtrarCartera quita lo que ya está en la ruta y busca sin acentos", () => {
    const cartera = [cliente("1", "Abarrotes Doña Lupe"), cliente("2", "Tienda La Esquina"), cliente("3", "Abarrotes Güero")];
    expect(filtrarCartera(cartera, new Set(["3"]), "").map((c) => c.id)).toEqual(["1", "2"]);
    expect(filtrarCartera(cartera, new Set(), "dona").map((c) => c.id)).toEqual(["1"]);
  });
});

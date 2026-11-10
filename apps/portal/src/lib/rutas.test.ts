import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import type { ClienteResumen } from "./clientes";
import {
  aEditable,
  agregarFila,
  aplicarRutaSemanal,
  asignarNota,
  filtrarCartera,
  filtrarPorFolio,
  fijarRecado,
  guardarRutaDiaria,
  hayCambios,
  moverFila,
  obtenerDia,
  obtenerNotas,
  obtenerOpciones,
  obtenerRutaDiaria,
  quitarFila,
  quitarNota,
  quitarRutaDiaria,
  type NotaDeRuta,
  type FilaEditable,
  type OrigenRuta,
  type RutaEditable,
} from "./rutas";

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return { ...real, apiFetch: vi.fn(), apiFetchSinCuerpo: vi.fn() };
});
const apiFetch = vi.mocked(api.apiFetch);
const apiFetchSinCuerpo = vi.mocked(api.apiFetchSinCuerpo);

const fila = (clienteId: string, origen: OrigenRuta = "oficina", recado: string | null = null): FilaEditable => ({
  clienteId,
  clienteNombre: `Cliente ${clienteId}`,
  origen,
  recado,
  notasAsignadas: 0,
});

const ruta = (filas: FilaEditable[], rutaSemanalId: string | null = null, vehiculoId: string | null = null): RutaEditable => ({
  rutaSemanalId,
  vehiculoId,
  filas,
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
    apiFetchSinCuerpo.mockResolvedValue(undefined);
  });

  it("obtenerDia pide la lista del día por fecha y sucursal", async () => {
    await obtenerDia("2026-11-10", "TJ");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria/dia?fecha=2026-11-10&sucursal=TJ");
  });

  it("obtenerRutaDiaria y obtenerOpciones piden por vendedor y fecha", async () => {
    await obtenerRutaDiaria("v1", "2026-11-10");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria?vendedorId=v1&fecha=2026-11-10");
    await obtenerOpciones("v1", "2026-11-10");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria/opciones?vendedorId=v1&fecha=2026-11-10");
  });

  it("guardarRutaDiaria hace PUT con ruta, vehículo y clientes con recado", async () => {
    const cuerpo = {
      vendedorId: "v1",
      fecha: "2026-11-10",
      rutaSemanalId: "rs1",
      vehiculoId: null,
      clientes: [
        { clienteId: "a", recado: "Solo contado" },
        { clienteId: "b", recado: null },
      ],
    };
    await guardarRutaDiaria(cuerpo);
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria", { method: "PUT", body: JSON.stringify(cuerpo) });
  });

  it("quitarRutaDiaria hace DELETE por vendedor y fecha", async () => {
    await quitarRutaDiaria("v1", "2026-11-10");
    expect(apiFetchSinCuerpo).toHaveBeenLastCalledWith("/rutas/diaria?vendedorId=v1&fecha=2026-11-10", {
      method: "DELETE",
    });
  });
});

describe("lib/rutas: edición local", () => {
  it("aEditable toma ruta, vehículo y las filas con recado y notas, en orden", () => {
    expect(
      aEditable({
        vendedor: { id: "v1", nombre: "Ricardo", sucursalCodigo: "TJ" },
        fecha: "2026-11-10",
        editable: true,
        rutaSemanal: { id: "rs1", nombre: "RUTA 1" },
        vehiculo: { id: "ve1", nombre: "Nissan" },
        filas: [
          { id: "r1", clienteId: "a", clienteNombre: "Cliente a", orden: 1, origen: "semanal", recado: "Hola", notasAsignadas: 2 },
          { id: "r2", clienteId: "b", clienteNombre: "Cliente b", orden: 2, origen: "vendedor", recado: null, notasAsignadas: 0 },
        ],
      }),
    ).toEqual(ruta([{ ...fila("a", "semanal", "Hola"), notasAsignadas: 2 }, fila("b", "vendedor")], "rs1", "ve1"));
  });

  it("moverFila sube y baja; fuera de rango no cambia nada", () => {
    const filas = [fila("a"), fila("b"), fila("c")];
    expect(moverFila(filas, 2, 1).map((f) => f.clienteId)).toEqual(["a", "c", "b"]);
    expect(moverFila(filas, 0, 1).map((f) => f.clienteId)).toEqual(["b", "a", "c"]);
    expect(moverFila(filas, 0, -1)).toBe(filas);
    expect(moverFila(filas, 2, 3)).toBe(filas);
  });

  it("quitarFila quita una de la oficina o de la semanal y nunca una del vendedor", () => {
    const filas = [fila("a"), fila("s", "semanal"), fila("b", "vendedor")];
    expect(quitarFila(filas, 0).map((f) => f.clienteId)).toEqual(["s", "b"]);
    expect(quitarFila(filas, 1).map((f) => f.clienteId)).toEqual(["a", "b"]);
    expect(quitarFila(filas, 2)).toBe(filas);
  });

  it("agregarFila agrega al final como de la oficina y no repite", () => {
    const filas = [fila("a")];
    expect(agregarFila(filas, { id: "b", nombre: "Cliente b" })).toEqual([fila("a"), fila("b")]);
    expect(agregarFila(filas, { id: "a", nombre: "Cliente a" })).toBe(filas);
  });

  it("fijarRecado recorta, deja null si queda vacío y no acepta más de 200 caracteres", () => {
    const filas = [fila("a"), fila("b")];
    expect(fijarRecado(filas, 1, "  Solo contado  ")[1].recado).toBe("Solo contado");
    expect(fijarRecado([fila("a", "oficina", "x")], 0, "   ")[0].recado).toBeNull();
    expect(fijarRecado(filas, 0, "a".repeat(200))[0].recado).toHaveLength(200);
    expect(fijarRecado(filas, 0, "a".repeat(201))).toBe(filas);
    expect(fijarRecado(filas, 5, "hola")).toBe(filas);
  });

  it("aplicarRutaSemanal saca las de la semanal anterior, mete las nuevas en su orden y deja las puestas a mano", () => {
    const filas = [fila("viejo", "semanal"), fila("m", "oficina", "recado"), fila("v", "vendedor"), fila("x", "semanal", "se queda")];
    const nuevas = [
      { clienteId: "n1", nombre: "Cliente n1", valido: true },
      { clienteId: "baja", nombre: "Cliente baja", valido: false },
      { clienteId: "x", nombre: "Cliente x", valido: true },
      { clienteId: "m", nombre: "Cliente m", valido: true },
    ];
    expect(aplicarRutaSemanal(filas, nuevas)).toEqual([
      fila("n1", "semanal"),
      fila("x", "semanal", "se queda"),
      fila("m", "oficina", "recado"),
      fila("v", "vendedor"),
    ]);
  });

  it("aplicarRutaSemanal sin clientes deja solo lo puesto a mano", () => {
    expect(aplicarRutaSemanal([fila("s", "semanal"), fila("v", "vendedor")], [])).toEqual([fila("v", "vendedor")]);
  });

  it("hayCambios cuenta orden, recados, ruta y vehículo", () => {
    const original = ruta([fila("a"), fila("b")], "rs1", "ve1");
    expect(hayCambios(original, ruta([fila("a"), fila("b")], "rs1", "ve1"))).toBe(false);
    expect(hayCambios(original, ruta([fila("b"), fila("a")], "rs1", "ve1"))).toBe(true);
    expect(hayCambios(original, ruta([fila("a")], "rs1", "ve1"))).toBe(true);
    expect(hayCambios(original, ruta([fila("a", "oficina", "hola"), fila("b")], "rs1", "ve1"))).toBe(true);
    expect(hayCambios(original, ruta([fila("a"), fila("b")], null, "ve1"))).toBe(true);
    expect(hayCambios(original, ruta([fila("a"), fila("b")], "rs1", null))).toBe(true);
  });

  it("filtrarCartera quita lo que ya está en la ruta y busca sin acentos", () => {
    const cartera = [cliente("1", "Abarrotes Doña Lupe"), cliente("2", "Tienda La Esquina"), cliente("3", "Abarrotes Güero")];
    expect(filtrarCartera(cartera, new Set(["3"]), "").map((c) => c.id)).toEqual(["1", "2"]);
    expect(filtrarCartera(cartera, new Set(), "dona").map((c) => c.id)).toEqual(["1"]);
  });

  it("obtenerNotas pide las notas del vendedor y día", async () => {
    await obtenerNotas("v1", "2026-11-10");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria/notas?vendedorId=v1&fecha=2026-11-10");
  });

  it("asignarNota hace PUT con vendedor y fecha en el cuerpo", async () => {
    await asignarNota("n1", "v1", "2026-11-10");
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria/notas/n1", {
      method: "PUT",
      body: JSON.stringify({ vendedorId: "v1", fecha: "2026-11-10" }),
    });
  });

  it("quitarNota hace DELETE con vendedor y fecha en la consulta y regresa las listas", async () => {
    apiFetch.mockResolvedValue({ pendientes: [], asignadas: [] });
    await expect(quitarNota("n1", "v1", "2026-11-10")).resolves.toEqual({ pendientes: [], asignadas: [] });
    expect(apiFetch).toHaveBeenLastCalledWith("/rutas/diaria/notas/n1?vendedorId=v1&fecha=2026-11-10", {
      method: "DELETE",
    });
  });
});

describe("filtrarPorFolio", () => {
  const nota = (folio: string): NotaDeRuta => ({
    ventaNotaId: folio,
    folio,
    clienteId: "c",
    cliente: "Cliente",
    fecha: "2026-11-01",
    saldoCentavos: 100,
    diasAtraso: 3,
    asignadaA: null,
  });
  it("busca sin mayúsculas ni acentos y vacío deja todo", () => {
    const notas = [nota("TJ261001AP01"), nota("TJ261002OF01")];
    expect(filtrarPorFolio(notas, "  ")).toBe(notas);
    expect(filtrarPorFolio(notas, "tj261002").map((n) => n.folio)).toEqual(["TJ261002OF01"]);
    expect(filtrarPorFolio(notas, "zzz")).toEqual([]);
  });
});

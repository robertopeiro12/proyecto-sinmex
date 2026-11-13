import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import {
  borradorDeCorte,
  conteosDe,
  estadoDeCorte,
  etiquetaEstadoCorte,
  guardarCorteVendedor,
  leerCortesDelDia,
  leerCorteVendedor,
  lineaAgregada,
  presentacionesParaAgregar,
  vistaCorte,
  type LineaCorte,
  textoHecho,
} from "./cortes";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

const linea = (id: string, m: Partial<LineaCorte> = {}): LineaCorte => {
  const base = {
    cargadas: 10,
    vendidas: 4,
    regaladas: 1,
    buenas: 0,
    merma: 0,
    faltante: null,
    ...m,
  };
  return {
    presentacionId: id,
    nombre: `Jamaica ${id}`,
    deberiaRegresar: base.cargadas - base.vendidas - base.regaladas,
    ...base,
  };
};

describe("llamadas a la API", () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it("la lista del día manda la sucursal o todas", () => {
    void leerCortesDelDia("2026-11-12", "TJ");
    void leerCortesDelDia("2026-11-12", null);
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      "/cortes?fecha=2026-11-12&sucursal=TJ",
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      "/cortes?fecha=2026-11-12&sucursal=todas",
    );
  });

  it("el corte del vendedor y su guardado", () => {
    void leerCorteVendedor("2026-11-12", "v1");
    expect(apiFetch).toHaveBeenCalledWith(
      "/cortes/vendedor?fecha=2026-11-12&vendedor=v1",
    );
    const datos = {
      fecha: "2026-11-12",
      vendedor: "v1",
      lineas: [{ presentacionId: "p1", buenas: 3, merma: 1 }],
    };
    void guardarCorteVendedor(datos);
    expect(apiFetch).toHaveBeenLastCalledWith("/cortes/vendedor", {
      method: "PUT",
      body: JSON.stringify(datos),
    });
  });
});

describe("etiquetaEstadoCorte", () => {
  it("Sin corte gris, Corte hecho, Faltan N rojo", () => {
    expect(
      etiquetaEstadoCorte({ estado: "sin_corte", piezasFaltantes: null }),
    ).toEqual({ texto: "Sin corte", tono: "neutro" });
    expect(
      etiquetaEstadoCorte({ estado: "hecho", piezasFaltantes: 0 }),
    ).toEqual({ texto: "Corte hecho", tono: "exito" });
    expect(
      etiquetaEstadoCorte({ estado: "con_faltante", piezasFaltantes: 7 }),
    ).toEqual({ texto: "Faltan 7", tono: "error" });
  });

  it("estadoDeCorte sigue la regla de la lista", () => {
    const totales = {
      cargadas: 0,
      vendidas: 0,
      regaladas: 0,
      deberiaRegresar: 0,
      buenas: 0,
      merma: 0,
    };
    expect(
      estadoDeCorte({ hecho: null, totales: { ...totales, faltante: null } })
        .estado,
    ).toBe("sin_corte");
    expect(
      estadoDeCorte({
        hecho: { en: "x", por: "Ana" },
        totales: { ...totales, faltante: 0 },
      }).estado,
    ).toBe("hecho");
    expect(
      estadoDeCorte({
        hecho: { en: "x", por: "Ana" },
        totales: { ...totales, faltante: 2 },
      }),
    ).toEqual({
      estado: "con_faltante",
      piezasFaltantes: 2,
    });
  });
});

describe("borradorDeCorte", () => {
  it("trae lo guardado y vacío si no hay: nunca el teórico", () => {
    expect(
      borradorDeCorte([linea("p1", { buenas: 3, merma: 0 }), linea("p2")]),
    ).toEqual({
      p1: { buenas: "3", merma: "" },
      p2: { buenas: "", merma: "" },
    });
  });
});

describe("vistaCorte", () => {
  it("sin corte y sin captura no muestra faltante", () => {
    const v = vistaCorte([linea("p1")], borradorDeCorte([linea("p1")]), false);
    expect(v.filas[0].faltante).toBeNull();
    expect(v.totales.faltante).toBeNull();
    expect(v.cambios).toBe(false);
    expect(v.sinPiezas).toBe(true);
  });

  it("con el corte hecho recalcula faltante y sobrante al editar; el total suma solo lo que falta", () => {
    const lineas = [linea("p1"), linea("p2"), linea("p3")]; // deberían 5 cada una
    const v = vistaCorte(
      lineas,
      {
        p1: { buenas: "2", merma: "1" },
        p2: { buenas: "8", merma: "" },
        p3: { buenas: "5", merma: "" },
      },
      true,
    );
    expect(v.filas.map((f) => f.faltante)).toEqual([3, -3, 0]);
    expect(v.totales.faltante).toBe(3);
    expect(v.totales.buenas).toBe(15);
    expect(v.totales.merma).toBe(1);
    expect(v.totales.deberiaRegresar).toBe(15);
    expect(v.cambios).toBe(true);
    expect(v.sinPiezas).toBe(false);
  });

  it("sin corte, solo el renglón tocado muestra su faltante; lo no contado no es faltante (D9)", () => {
    const lineas = [linea("p1"), linea("p2"), linea("p3")]; // deberían 5 cada una
    const v = vistaCorte(
      lineas,
      { p1: { buenas: "2", merma: "" } },
      false,
      new Set(["p1"]),
    );
    expect(v.filas.map((f) => f.faltante)).toEqual([3, null, null]);
    expect(v.cambios).toBe(true);
  });

  it("sin corte, el total de faltante queda vacío aunque haya cambios", () => {
    const v = vistaCorte(
      [linea("p1"), linea("p2")],
      { p1: { buenas: "1", merma: "" } },
      false,
      new Set(["p1"]),
    );
    expect(v.totales.faltante).toBeNull();
  });

  it("un renglón tocado y borrado de nuevo sigue mostrando su vista previa", () => {
    const v = vistaCorte(
      [linea("p1")],
      { p1: { buenas: "", merma: "" } },
      false,
      new Set(["p1"]),
    );
    expect(v.filas[0].faltante).toBe(5);
    expect(v.totales.faltante).toBeNull();
  });

  it("con el corte hecho muestra el faltante aunque no haya cambios", () => {
    const l = linea("p1", { buenas: 5, faltante: 0 });
    const v = vistaCorte([l], borradorDeCorte([l]), true);
    expect(v.filas[0].faltante).toBe(0);
    expect(v.totales.faltante).toBe(0);
    expect(v.cambios).toBe(false);
  });

  it("debería negativo (vendió más de lo cargado) se respeta tal cual", () => {
    const l = linea("p1", { cargadas: 0, vendidas: 3, regaladas: 0 });
    const v = vistaCorte([l], {}, true);
    expect(v.totales.deberiaRegresar).toBe(-3);
    expect(v.filas[0].faltante).toBe(-3);
    expect(v.totales.faltante).toBe(0);
  });

  it("un texto que no es entero invalida y no cuenta", () => {
    const v = vistaCorte(
      [linea("p1")],
      { p1: { buenas: "2.5", merma: "-1" } },
      false,
    );
    expect(v.hayInvalidas).toBe(true);
    expect(v.filas[0]).toMatchObject({
      buenas: null,
      merma: null,
      faltante: null,
    });
  });

  it("conteosDe manda todas las líneas con vacío = 0", () => {
    const v = vistaCorte(
      [linea("p1"), linea("p2")],
      { p1: { buenas: "4", merma: "" } },
      false,
    );
    expect(conteosDe(v)).toEqual([
      { presentacionId: "p1", buenas: 4, merma: 0 },
      { presentacionId: "p2", buenas: 0, merma: 0 },
    ]);
  });

  it("una presentación agregada vacía no cuenta como cambio", () => {
    const v = vistaCorte([lineaAgregada("p9", "Horchata 1 L")], {}, false);
    expect(v.cambios).toBe(false);
    expect(v.filas[0].linea).toMatchObject({
      cargadas: 0,
      deberiaRegresar: 0,
      nombre: "Horchata 1 L",
    });
  });
});

describe("presentacionesParaAgregar", () => {
  it("las vivas de productos activos que no están en la tabla, por nombre", () => {
    const productos = [
      {
        id: "a",
        nombre: "Jamaica",
        activo: true,
        presentaciones: [
          { id: "p1", volumen: "1 L" },
          { id: "p2", volumen: "500 ml" },
        ],
      },
      {
        id: "b",
        nombre: "Horchata",
        activo: true,
        presentaciones: [{ id: "p3", volumen: "1 L" }],
      },
      {
        id: "c",
        nombre: "Tamarindo",
        activo: false,
        presentaciones: [{ id: "p4", volumen: "1 L" }],
      },
    ];
    expect(
      presentacionesParaAgregar(productos, [{ presentacionId: "p1" }]),
    ).toEqual([
      { id: "p3", nombre: "Horchata 1 L" },
      { id: "p2", nombre: "Jamaica 500 ml" },
    ]);
  });
});

describe("textoHecho", () => {
  it("dice el día y la hora como se leen", () => {
    expect(textoHecho({ en: "2026-11-12 12:58", por: "Luis" })).toBe(
      "Hecho por Luis el jueves 12 de noviembre a las 12:58.",
    );
  });
  it("una forma desconocida sale tal cual", () => {
    expect(textoHecho({ en: "ayer", por: "Luis" })).toBe(
      "Hecho por Luis ayer.",
    );
  });
});

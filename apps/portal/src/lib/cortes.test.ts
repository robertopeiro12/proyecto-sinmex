import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import {
  borradorDeCorte,
  claveTamano,
  compararTamano,
  mililitros,
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
    mermaEntregada: 0,
    mermaRecibida: 0,
    mermaAlmacen: 0,
    consumo: 0,
    cambiosEntregados: 0,
    cambiosRecibidos: 0,
    buenas: 0,
    merma: 0,
    mermaTeorica: 0,
    faltante: null,
    resultadoMerma: null,
    ...m,
  };
  return {
    presentacionId: id,
    nombre: `Jamaica ${id}`,
    producto: "Jamaica",
    volumen: "1 L",
    deberiaRegresar: base.cargadas - base.vendidas - base.regaladas,
    ...base,
  };
};

const totalesVacios = {
  cargadas: 0,
  vendidas: 0,
  regaladas: 0,
  mermaEntregada: 0,
  mermaRecibida: 0,
  mermaAlmacen: 0,
  consumo: 0,
  cambiosEntregados: 0,
  cambiosRecibidos: 0,
  deberiaRegresar: 0,
  mermaTeorica: 0,
  buenas: 0,
  merma: 0,
  faltanteMerma: null,
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

describe("claveTamano, mililitros y compararTamano (espejo del backend)", () => {
  it("claveTamano: minúsculas y sin espacios", () => {
    expect(claveTamano("500 ml")).toBe("500ml");
    expect(claveTamano("500ML")).toBe("500ml");
    expect(claveTamano(" 500ml ")).toBe("500ml");
  });

  it("mililitros lee ml y litros, con punto o coma", () => {
    expect(mililitros("355 ml")).toBe(355);
    expect(mililitros("1 L")).toBe(1000);
    expect(mililitros("1.5 L")).toBe(1500);
    expect(mililitros("1,5 lt")).toBe(1500);
    expect(mililitros("Garrafón")).toBeNull();
  });

  it("compararTamano ordena por mililitros y deja al final lo ilegible", () => {
    expect(
      ["1 L", "Garrafón", "355 ml", "600 ml", "500ml"].sort(compararTamano),
    ).toEqual(["355 ml", "500ml", "600 ml", "1 L", "Garrafón"]);
  });
});

describe("etiquetaEstadoCorte", () => {
  const e = (
    estado: "sin_corte" | "hecho" | "con_faltante",
    piezasFaltantes: number | null,
    mermaFaltante: number | null,
  ) => etiquetaEstadoCorte({ estado, piezasFaltantes, mermaFaltante });

  it("Sin corte gris, Corte hecho, Faltan N rojo", () => {
    expect(e("sin_corte", null, null)).toEqual({
      texto: "Sin corte",
      tono: "neutro",
    });
    expect(e("hecho", 0, 0)).toEqual({ texto: "Corte hecho", tono: "exito" });
    expect(e("con_faltante", 7, 0)).toEqual({
      texto: "Faltan: 7 pz p/Almacen",
      tono: "error",
    });
  });

  it("piezas y merma se unen; solo merma = Faltan: N pz merma", () => {
    expect(e("con_faltante", 3, 1).texto).toBe("Faltan: 3 pz p/Almacen · 1 pz merma");
    expect(e("con_faltante", 0, 2).texto).toBe("Faltan: 2 pz merma");
    expect(e("con_faltante", 3, 0).texto).toBe("Faltan: 3 pz p/Almacen");
    expect(e("con_faltante", 1, 0).texto).toBe("Faltan: 1 pz p/Almacen");
    expect(e("con_faltante", 0, 1).texto).toBe("Faltan: 1 pz merma");
    expect(e("con_faltante", 1, 2).texto).toBe("Faltan: 1 pz p/Almacen · 2 pz merma");
  });

  it("estadoDeCorte sigue la regla de la lista", () => {
    expect(
      estadoDeCorte({
        hecho: null,
        totales: { ...totalesVacios, faltante: null },
      }),
    ).toEqual({
      estado: "sin_corte",
      piezasFaltantes: null,
      mermaFaltante: null,
    });
    expect(
      estadoDeCorte({
        hecho: { en: "x", por: "Ana" },
        totales: { ...totalesVacios, faltante: 0, faltanteMerma: 0 },
      }).estado,
    ).toBe("hecho");
    expect(
      estadoDeCorte({
        hecho: { en: "x", por: "Ana" },
        totales: { ...totalesVacios, faltante: 2, faltanteMerma: 1 },
      }),
    ).toEqual({
      estado: "con_faltante",
      piezasFaltantes: 2,
      mermaFaltante: 1,
    });
    expect(
      estadoDeCorte({
        hecho: { en: "x", por: "Ana" },
        totales: { ...totalesVacios, faltante: 0, faltanteMerma: 2 },
      }).estado,
    ).toBe("con_faltante");
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
    const lineas = [
      linea("p1", { volumen: "355 ml" }),
      linea("p2", { volumen: "500 ml" }),
      linea("p3", { volumen: "1 L" }),
    ]; // deberían 5 cada una, cada una de su tamaño
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
    const v = vistaCorte([lineaAgregada("p9", "Horchata", "1 L")], {}, false);
    expect(v.cambios).toBe(false);
    expect(v.filas[0].linea).toMatchObject({
      cargadas: 0,
      deberiaRegresar: 0,
      nombre: "Horchata 1 L",
      producto: "Horchata",
      volumen: "1 L",
      faltante: null,
      resultadoMerma: null,
    });
  });
});

describe("vistaCorte por tamaño y merma", () => {
  const l355 = (id: string, m: Partial<LineaCorte> = {}) =>
    linea(id, { volumen: "355 ml", ...m });

  it("ejemplo 355 ml del cliente: faltante 0 y merma con resultado 1", () => {
    const lineas = [
      l355("a", { cargadas: 5, vendidas: 0, regaladas: 0, mermaTeorica: 1 }),
      l355("b", { cargadas: 5, vendidas: 0, regaladas: 0, mermaTeorica: 0 }),
    ];
    const v = vistaCorte(
      lineas,
      {
        a: { buenas: "4", merma: "" },
        b: { buenas: "6", merma: "" },
      },
      true,
    );
    expect(v.filas.map((f) => f.faltante)).toEqual([1, -1]);
    expect(v.grupos).toHaveLength(1);
    expect(v.grupos[0].tamano).toBe("355 ml");
    expect(v.grupos[0].totales.faltante).toBe(0);
    expect(v.grupos[0].totales.resultadoMerma).toBe(1);
    expect(v.filas.map((f) => f.resultadoMerma)).toEqual([1, 0]);
    expect(v.totales.faltante).toBe(0);
    expect(v.totales.faltanteMerma).toBe(1);
  });

  it("grupos en orden de tamaño; 500ML cae con 500 ml; lo ilegible al final", () => {
    const lineas = [
      linea("g", { volumen: "Garrafón", producto: "Agua" }),
      linea("a", { volumen: "1 L", producto: "Horchata" }),
      linea("b", { volumen: "500 ml", producto: "Jamaica" }),
      linea("c", { volumen: "500ML", producto: "Horchata" }),
      linea("d", { volumen: "355 ml", producto: "Té" }),
    ];
    const v = vistaCorte(lineas, {}, true);
    expect(v.grupos.map((g) => g.tamano)).toEqual([
      "355 ml",
      "500ML",
      "1 L",
      "Garrafón",
    ]);
    expect(v.grupos[1].filas.map((f) => f.linea.presentacionId)).toEqual([
      "c",
      "b",
    ]); // por producto: Horchata antes que Jamaica
  });

  it("sin hecho solo las tocadas muestran resultados y el total del día es null", () => {
    const lineas = [
      l355("a", { mermaTeorica: 2 }),
      l355("b", { mermaTeorica: 3 }),
    ];
    const v = vistaCorte(
      lineas,
      { a: { buenas: "2", merma: "1" } },
      false,
      new Set(["a"]),
    );
    expect(v.filas[0].resultadoMerma).toBe(1);
    expect(v.filas[1].resultadoMerma).toBeNull();
    expect(v.filas[1].faltante).toBeNull();
    expect(v.grupos[0].totales.faltante).toBe(3);
    expect(v.grupos[0].totales.resultadoMerma).toBe(1);
    expect(v.totales.faltante).toBeNull();
    expect(v.totales.faltanteMerma).toBeNull();
  });

  it("sin ninguna fila visible, los resultados del grupo son null", () => {
    const v = vistaCorte([l355("a")], {}, false);
    expect(v.grupos[0].totales.faltante).toBeNull();
    expect(v.grupos[0].totales.resultadoMerma).toBeNull();
  });

  it("D1: un tamaño no tapa a otro", () => {
    const lineas = [
      linea("a", { volumen: "355 ml", cargadas: 5, vendidas: 0, regaladas: 0 }),
      linea("b", { volumen: "1 L", cargadas: 5, vendidas: 0, regaladas: 0 }),
    ];
    const v = vistaCorte(
      lineas,
      { a: { buenas: "2", merma: "" }, b: { buenas: "9", merma: "" } },
      true,
    );
    expect(v.grupos.map((g) => g.totales.faltante)).toEqual([3, -4]);
    expect(v.totales.faltante).toBe(3);
  });

  it("los totales suman los conceptos nuevos", () => {
    const v = vistaCorte(
      [
        linea("a", { consumo: 2, mermaRecibida: 1 }),
        linea("b", { consumo: 1 }),
      ],
      {},
      true,
    );
    expect(v.totales.consumo).toBe(3);
    expect(v.totales.mermaRecibida).toBe(1);
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
      {
        id: "p3",
        nombre: "Horchata 1 L",
        producto: "Horchata",
        volumen: "1 L",
      },
      {
        id: "p2",
        nombre: "Jamaica 500 ml",
        producto: "Jamaica",
        volumen: "500 ml",
      },
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

import { describe, expect, it } from "vitest";
import {
  camposDeCondiciones,
  capturaDeLineas,
  condicionesDeVenta,
  filasDeCatalogo,
  filasDeEdicion,
  formatearPesos,
  hoyEnTijuana,
  leerPiezas,
  lineasDeCaptura,
  normalizarTexto,
  totalDeCaptura,
  type PresentacionDeCatalogo,
  type VentaDetalle,
} from "./ventas";

describe("hoyEnTijuana", () => {
  it("a las 22:30 de Tijuana devuelve hoy, aunque en UTC ya sea mañana", () => {
    // 2026-10-07T05:30Z = 2026-10-06 22:30 en Tijuana (UTC-7, horario de verano).
    expect(hoyEnTijuana(new Date("2026-10-07T05:30:00Z"))).toBe("2026-10-06");
  });

  it("en invierno (UTC-8) tambien", () => {
    expect(hoyEnTijuana(new Date("2026-12-02T07:59:00Z"))).toBe("2026-12-01");
  });
});

describe("leerPiezas", () => {
  it.each([
    ["", 0],
    ["0", 0],
    ["24", 24],
    [" 5 ", 5],
  ])("%j son %i piezas", (texto, piezas) => {
    expect(leerPiezas(texto)).toBe(piezas);
  });

  it.each(["2.5", "-1", "abc", "1e3"])("%j no es un numero de piezas", (texto) => {
    expect(leerPiezas(texto)).toBeNull();
  });
});

describe("formatearPesos", () => {
  it("centavos a pesos con dos decimales", () => {
    expect(formatearPesos(27000)).toBe("$270.00");
    expect(formatearPesos(123456)).toBe("$1,234.56");
  });
});

const CATALOGO: PresentacionDeCatalogo[] = [
  { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 1000 },
  { presentacionId: "p2", producto: "Jamaica", volumen: "500 ml", precioCentavos: 600 },
  { presentacionId: "p3", producto: "Tamarindo", volumen: "2 L", precioCentavos: null },
];

const VENTA: VentaDetalle = {
  id: "v1",
  folio: "TJ240304OF01",
  fecha: "2024-03-04",
  clienteId: "c1",
  cliente: "Abarrotes Lupita",
  sucursalId: "suc-tj",
  sucursalCodigo: "TJ",
  vendedorId: "v-ana",
  repartidor: "Ana Pérez",
  numNota: "1234",
  contadoCredito: "contado",
  factura: "pendiente",
  comentarios: null,
  montoCentavos: 21600,
  status: "pagada",
  origen: "portal",
  saldoCentavos: 0,
  lineas: [
    {
      presentacionId: "p1",
      producto: "Horchata",
      volumen: "1 L",
      cantidad: 24,
      cantidadPromocion: 2,
      precioCentavos: 900,
      subtotalCentavos: 21600,
    },
    {
      presentacionId: "p3",
      producto: "Tamarindo",
      volumen: "2 L",
      cantidad: 0,
      cantidadPromocion: 1,
      precioCentavos: 0,
      subtotalCentavos: 0,
    },
  ],
  cobros: [
    { id: "a1", fechaPago: "2024-03-04", metodoPago: "efectivo", montoCentavos: 21600, origen: "venta_contado" },
  ],
  editable: true,
  motivoNoEditable: null,
  puedeMarcarPerdida: false,
};

describe("normalizarTexto", () => {
  it("quita acentos y mayúsculas", () => {
    expect(normalizarTexto("José ÁLVAREZ")).toBe("jose alvarez");
  });
});

describe("filas de la tabla de productos", () => {
  it("al registrar, una presentación sin precio queda deshabilitada", () => {
    expect(filasDeCatalogo(CATALOGO).map((f) => [f.presentacionId, f.deshabilitada])).toEqual([
      ["p1", false],
      ["p2", false],
      ["p3", true],
    ]);
  });

  it("al editar, las líneas existentes van primero con su precio guardado y nunca deshabilitadas", () => {
    expect(filasDeEdicion(VENTA.lineas, CATALOGO)).toEqual([
      { presentacionId: "p1", producto: "Horchata", volumen: "1 L", precioCentavos: 900, deshabilitada: false },
      // Línea de promoción ($0) sin precio en la lista: se puede seguir capturando promoción.
      { presentacionId: "p3", producto: "Tamarindo", volumen: "2 L", precioCentavos: 0, deshabilitada: false },
      { presentacionId: "p2", producto: "Jamaica", volumen: "500 ml", precioCentavos: 600, deshabilitada: false },
    ]);
  });

  it("al editar, una línea de promoción ($0) muestra el precio de la lista si lo hay", () => {
    const filas = filasDeEdicion([{ ...VENTA.lineas[1], presentacionId: "p2", producto: "Jamaica" }], CATALOGO);
    expect(filas[0]).toMatchObject({ presentacionId: "p2", precioCentavos: 600 });
  });

  it("al editar, una presentación nueva sin precio a la fecha queda deshabilitada", () => {
    const filas = filasDeEdicion([VENTA.lineas[0]], CATALOGO);
    expect(filas.find((f) => f.presentacionId === "p3")).toMatchObject({ deshabilitada: true });
  });
});

describe("captura → líneas del payload", () => {
  const filas = filasDeEdicion(VENTA.lineas, CATALOGO);

  it("capturaDeLineas precarga lo guardado (0 como vacío)", () => {
    expect(capturaDeLineas(VENTA.lineas)).toEqual({
      p1: { cantidad: "24", promocion: "2" },
      p3: { cantidad: "", promocion: "1" },
    });
  });

  it("arma solo las filas con piezas, sin precios", () => {
    const r = lineasDeCaptura(filas, {
      ...capturaDeLineas(VENTA.lineas),
      p2: { cantidad: "3", promocion: "" },
    });
    expect(r).toEqual({
      ok: true,
      lineas: [
        { presentacionId: "p1", cantidad: 24, cantidadPromocion: 2 },
        { presentacionId: "p3", cantidad: 0, cantidadPromocion: 1 },
        { presentacionId: "p2", cantidad: 3, cantidadPromocion: 0 },
      ],
    });
  });

  it("una fila deshabilitada nunca viaja", () => {
    const r = lineasDeCaptura(filasDeCatalogo(CATALOGO), { p3: { cantidad: "5", promocion: "" } });
    expect(r).toEqual({ ok: false, error: "Captura al menos un producto." });
  });

  it("una cantidad no entera es un error, no un 0", () => {
    expect(lineasDeCaptura(filas, { p1: { cantidad: "2.5", promocion: "" } })).toEqual({
      ok: false,
      error: "Las cantidades deben ser números enteros de 0 en adelante.",
    });
  });

  it("totalDeCaptura suma cantidad × precio de las filas habilitadas", () => {
    expect(totalDeCaptura(filas, { p1: { cantidad: "2", promocion: "9" }, p2: { cantidad: "1", promocion: "" } })).toBe(2400);
  });
});

describe("condiciones de la venta", () => {
  it("camposDeCondiciones recorta, y omite método en crédito y comentarios vacíos", () => {
    expect(
      camposDeCondiciones({ numNota: " 77 ", contadoCredito: "credito", metodoPago: "efectivo", factura: "N/A", comentarios: "  " }),
    ).toEqual({ numNota: "77", contadoCredito: "credito", factura: "N/A" });
    expect(
      camposDeCondiciones({ numNota: "77", contadoCredito: "contado", metodoPago: "efectivo", factura: "pendiente", comentarios: " ok " }),
    ).toEqual({ numNota: "77", contadoCredito: "contado", metodoPago: "efectivo", factura: "pendiente", comentarios: "ok" });
    // Sin nota de papel (lo normal): viaja null, no una cadena vacía.
    expect(
      camposDeCondiciones({ numNota: "   ", contadoCredito: "credito", metodoPago: "efectivo", factura: "N/A", comentarios: "" }),
    ).toEqual({ numNota: null, contadoCredito: "credito", factura: "N/A" });
  });

  it("condicionesDeVenta precarga la venta y el método de su cobro de contado", () => {
    expect(condicionesDeVenta(VENTA)).toEqual({
      numNota: "1234",
      contadoCredito: "contado",
      metodoPago: "efectivo",
      factura: "pendiente",
      comentarios: "",
    });
  });

  it("sin cobro de contado, el método propuesto es transferencia", () => {
    expect(condicionesDeVenta({ ...VENTA, contadoCredito: "credito", cobros: [] }).metodoPago).toBe("transferencia");
  });
});

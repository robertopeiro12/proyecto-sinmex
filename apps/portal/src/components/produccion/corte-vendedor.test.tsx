import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as lib from "@/lib/cortes";
import type { CorteVendedor as Corte, LineaCorte } from "@/lib/cortes";
import * as productosLib from "@/lib/productos";
import { CorteVendedor } from "./corte-vendedor";

vi.mock("@/lib/cortes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cortes")>();
  return { ...real, leerCorteVendedor: vi.fn(), guardarCorteVendedor: vi.fn() };
});
vi.mock("@/lib/productos", () => ({ listarProductos: vi.fn() }));

const FECHA = "2026-11-11";
const VENDEDOR = { id: "v1", nombre: "Ana Pérez" };

const linea = (
  id: string,
  producto: string,
  volumen: string,
  m: Partial<LineaCorte> = {},
): LineaCorte => {
  const cargadas = m.cargadas ?? 10;
  const vendidas = m.vendidas ?? 4;
  const regaladas = m.regaladas ?? 1;
  return {
    presentacionId: id,
    nombre: `${producto} ${volumen}`,
    producto,
    volumen,
    cargadas,
    vendidas,
    regaladas,
    mermaEntregada: 0,
    mermaRecibida: 0,
    mermaAlmacen: 0,
    consumo: 0,
    cambiosEntregados: 0,
    cambiosRecibidos: 0,
    deberiaRegresar: cargadas - vendidas - regaladas,
    buenas: 0,
    faltante: null,
    merma: 0,
    mermaTeorica: 0,
    resultadoMerma: null,
    ...m,
  };
};

const corte = (
  lineas: LineaCorte[],
  hecho: Corte["hecho"] = null,
  faltantes: { faltante: number; faltanteMerma: number } | null = null,
): Corte => {
  const suma = (f: (l: LineaCorte) => number) =>
    lineas.reduce((t, l) => t + f(l), 0);
  return {
    fecha: FECHA,
    hoy: "2026-11-12",
    vendedor: VENDEDOR,
    sucursal: { id: "s", codigo: "TJ" },
    lineas,
    totales: {
      cargadas: suma((l) => l.cargadas),
      vendidas: suma((l) => l.vendidas),
      regaladas: suma((l) => l.regaladas),
      mermaEntregada: 0,
      mermaRecibida: 0,
      mermaAlmacen: 0,
      consumo: 0,
      cambiosEntregados: 0,
      cambiosRecibidos: 0,
      deberiaRegresar: suma((l) => l.deberiaRegresar),
      mermaTeorica: suma((l) => l.mermaTeorica),
      buenas: suma((l) => l.buenas),
      merma: suma((l) => l.merma),
      faltante: hecho
        ? (faltantes?.faltante ??
          suma((l) => Math.max(l.faltante ?? 0, 0)))
        : null,
      faltanteMerma: hecho ? (faltantes?.faltanteMerma ?? 0) : null,
    },
    hecho,
  };
};

const SIN_CORTE = corte([
  linea("p1", "Jamaica", "1 L"),
  linea("p2", "Horchata", "1 L", { cargadas: 0, vendidas: 3, regaladas: 0 }),
]);

const buenas = (nombre: string) =>
  screen.getByLabelText(`Piezas reales de ${nombre}`);
const merma = (nombre: string) =>
  screen.getByLabelText(`Merma real de ${nombre}`);
const renglon = (nombre: string) => {
  const tr = buenas(nombre).closest("tr");
  if (!tr) throw new Error("sin renglón");
  return within(tr);
};
/** Las celdas de un renglón: 3 = resultado de piezas, 6 = resultado de merma. */
const celda = (nombre: string, n: number) => {
  const tr = buenas(nombre).closest("tr")!;
  return tr.querySelectorAll("td")[n].firstElementChild as HTMLElement;
};
const total = (tamano: string) =>
  within(screen.getByText(`Total ${tamano}`).closest("tr")!);

const DOS_TAMANOS = corte([
  linea("p5", "Horchata", "500 ml", { cargadas: 5, vendidas: 0, regaladas: 0 }),
  linea("p1", "Horchata", "355 ml", { cargadas: 6, vendidas: 0, regaladas: 0 }),
]);

function montar(onVolver = vi.fn()) {
  render(<CorteVendedor fecha={FECHA} vendedor={VENDEDOR} onVolver={onVolver} />);
  return onVolver;
}

describe("CorteVendedor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lib.leerCorteVendedor).mockResolvedValue(SIN_CORTE);
    vi.mocked(productosLib.listarProductos).mockResolvedValue([
      {
        id: "a",
        nombre: "Jamaica",
        activo: true,
        presentaciones: [
          { id: "p1", volumen: "1 L" },
          { id: "p3", volumen: "500 ml" },
        ],
      },
    ]);
  });

  it("pide el corte, pinta los encabezados de dos niveles y los campos vacíos (nunca el teórico)", async () => {
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    expect(lib.leerCorteVendedor).toHaveBeenCalledWith(FECHA, "v1");
    expect(
      screen.getByRole("heading", { name: "Corte · Ana Pérez" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Cuenta lo que regresó y anota las piezas buenas y la merma de cada producto\./,
      ),
    ).toBeInTheDocument();
    for (const t of [
      "Producto",
      "Producto terminado",
      "Merma",
      /^Piezas teóricas por regresar/,
      "Piezas reales retornadas",
      /^Merma teórica por regresar/,
      "Merma real validada",
    ]) {
      expect(screen.getByRole("columnheader", { name: t })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("columnheader", { name: "Resultado" })).toHaveLength(2);
    for (const viejo of ["Cargadas", "Vendidas", "Regaladas", "Debería regresar"]) {
      expect(screen.queryByRole("columnheader", { name: viejo })).toBeNull();
    }
    expect(buenas("Jamaica 1 L")).toHaveValue("");
    expect(merma("Jamaica 1 L")).toHaveValue("");
    expect(renglon("Jamaica 1 L").getByText("5")).toBeInTheDocument();
    expect(renglon("Jamaica 1 L").getByText("Jamaica")).toBeInTheDocument();
    expect(screen.getByText("Sin corte")).toBeInTheDocument();
    expect(screen.queryByText(/se restarán cuando la app/)).toBeNull();
  });

  it("la Ayuda explica las dos columnas teóricas", async () => {
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    expect(screen.getAllByRole("button", { name: /Qué permite/ })).toHaveLength(2);
    await userEvent.hover(
      screen.getByRole("button", { name: "Qué permite: Piezas teóricas por regresar" }),
    );
    expect(
      await screen.findByText(
        "Cargadas − vendidas − promoción − merma entregada al cliente − merma de almacén − consumo − cambios entregados + cambios recibidos.",
      ),
    ).toBeInTheDocument();
  });

  it("con dos tamaños salen dos secciones en orden, cada una con su Total", async () => {
    vi.mocked(lib.leerCorteVendedor).mockResolvedValue(DOS_TAMANOS);
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    const secciones = screen
      .getAllByRole("rowheader")
      .map((e) => e.textContent);
    expect(secciones).toEqual(["355 ml", "500 ml"]);
    expect(total("355 ml").getByText("6")).toBeInTheDocument();
    expect(total("500 ml").getByText("5")).toBeInTheDocument();
    const textos = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    const pos = (t: string) => textos.findIndex((x) => x.startsWith(t));
    expect(pos("355 ml")).toBeLessThan(pos("Total 355 ml"));
    expect(pos("Total 355 ml")).toBeLessThan(pos("500 ml"));
    expect(pos("500 ml")).toBeLessThan(pos("Total 500 ml"));
  });

  it("debería negativo lleva el aviso Salió más de lo cargado", async () => {
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    expect(
      renglon("Horchata 1 L").getByText("Salió más de lo cargado"),
    ).toBeInTheDocument();
    expect(renglon("Horchata 1 L").getByText("-3")).toBeInTheDocument();
    expect(
      renglon("Jamaica 1 L").queryByText("Salió más de lo cargado"),
    ).toBeNull();
  });

  it("un corte hecho: resultado > 0 en rojo, negativo sin rojo, y los faltantes del día al pie", async () => {
    vi.mocked(lib.leerCorteVendedor).mockResolvedValue(
      corte(
        [
          linea("p1", "Jamaica", "1 L", {
            buenas: 3,
            merma: 1,
            faltante: 2,
            mermaTeorica: 4,
            resultadoMerma: 3,
          }),
          linea("p2", "Horchata", "500 ml", {
            cargadas: 5,
            vendidas: 0,
            regaladas: 0,
            buenas: 7,
            faltante: -2,
            mermaTeorica: 0,
            resultadoMerma: 0,
          }),
        ],
        { en: "2026-11-11 16:00", por: "Luis Almacén" },
        { faltante: 2, faltanteMerma: 3 },
      ),
    );
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    expect(buenas("Jamaica 1 L")).toHaveValue("3");
    expect(merma("Jamaica 1 L")).toHaveValue("1");
    expect(
      screen.getByText("Faltan 2 · 3 de merma", { selector: "[data-tono]" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hecho por Luis Almacén/)).toBeInTheDocument();
    expect(celda("Jamaica 1 L", 3)).toHaveTextContent("2");
    expect(celda("Jamaica 1 L", 3)).toHaveClass("text-destructive");
    expect(celda("Jamaica 1 L", 6)).toHaveTextContent("3");
    expect(celda("Jamaica 1 L", 6)).toHaveClass("text-destructive");
    expect(celda("Horchata 500 ml", 3)).toHaveTextContent("-2");
    expect(celda("Horchata 500 ml", 3)).not.toHaveClass("text-destructive");
    expect(celda("Horchata 500 ml", 6)).toHaveTextContent("0");
    expect(celda("Horchata 500 ml", 6)).not.toHaveClass("text-destructive");
    // Los faltantes del día no se compensan entre renglones.
    expect(screen.getByText("Faltan 2")).toHaveClass("text-destructive");
    expect(screen.getByText("3 de merma")).toHaveClass("text-destructive");
  });

  it("escribir la merma real recalcula el resultado de merma", async () => {
    vi.mocked(lib.leerCorteVendedor).mockResolvedValue(
      corte(
        [
          linea("p1", "Horchata", "355 ml", {
            cargadas: 3,
            vendidas: 0,
            regaladas: 0,
            buenas: 3,
            faltante: 0,
            mermaTeorica: 5,
            resultadoMerma: 5,
          }),
        ],
        { en: "2026-11-11 16:00", por: "Ana" },
      ),
    );
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    await userEvent.type(merma("Horchata 355 ml"), "2");
    // 5 − 2 = 3, en la fila y en el total del tamaño.
    expect(celda("Horchata 355 ml", 6)).toHaveTextContent("3");
    expect(celda("Horchata 355 ml", 6)).toHaveClass("text-destructive");
    expect(
      screen.getByText("Total 355 ml").closest("tr")!.querySelectorAll("td")[6],
    ).toHaveTextContent("3");
    await userEvent.type(merma("Horchata 355 ml"), "0");
    // 20 > 5: sobran 15.
    expect(celda("Horchata 355 ml", 6)).toHaveTextContent("-15");
    expect(celda("Horchata 355 ml", 6)).not.toHaveClass("text-destructive");
  });

  it("Agregar presentación de otro tamaño crea su sección en su orden", async () => {
    vi.mocked(lib.leerCorteVendedor).mockResolvedValue(
      corte([linea("p1", "Jamaica", "1 L")]),
    );
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    const lista = await screen.findByLabelText("Agregar presentación");
    await waitFor(() =>
      expect(
        within(lista).getByRole("option", { name: "Jamaica 500 ml" }),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(lista, "Jamaica 500 ml");
    await userEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(screen.getAllByRole("rowheader").map((e) => e.textContent)).toEqual([
      "500 ml",
      "1 L",
    ]);
    expect(buenas("Jamaica 500 ml")).toBeInTheDocument();
  });

  it("la pastilla dice Falta 1 · 1 de merma con el corte guardado", async () => {
    vi.mocked(lib.leerCorteVendedor).mockResolvedValue(
      corte(
        [linea("p1", "Jamaica", "1 L", { buenas: 4, faltante: 1, resultadoMerma: 1 })],
        { en: "2026-11-11 16:00", por: "Ana" },
        { faltante: 1, faltanteMerma: 1 },
      ),
    );
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    expect(screen.getByText("Falta 1 · 1 de merma")).toBeInTheDocument();
  });

  it("Guardar corte manda todas las líneas con vacío = 0 y avisa", async () => {
    vi.mocked(lib.guardarCorteVendedor).mockResolvedValue(
      corte([linea("p1", "Jamaica", "1 L", { buenas: 5, faltante: 0 })], {
        en: "2026-11-11 16:00",
        por: "Ana",
      }),
    );
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    await userEvent.type(buenas("Jamaica 1 L"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Guardar corte" }));
    expect(lib.guardarCorteVendedor).toHaveBeenCalledWith({
      fecha: FECHA,
      vendedor: "v1",
      lineas: [
        { presentacionId: "p1", buenas: 5, merma: 0 },
        { presentacionId: "p2", buenas: 0, merma: 0 },
      ],
    });
    expect(await screen.findByText("Corte guardado.")).toBeInTheDocument();
    expect(screen.getByText("Corte hecho")).toBeInTheDocument();
  });

  it("sin corte, solo el renglón tocado muestra su resultado y los faltantes del día quedan vacíos (D9)", async () => {
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    await userEvent.type(buenas("Jamaica 1 L"), "3");
    expect(renglon("Jamaica 1 L").getByText("2")).toHaveClass("text-destructive");
    expect(renglon("Horchata 1 L").queryByText("-3", { selector: "span.font-semibold, span.text-muted-foreground" })).toBeNull();
    expect(screen.queryByText(/^Faltan \d/, { selector: "span" })).toBeNull();
  });

  it("mientras guarda, Volver y Cancelar no se pueden usar", async () => {
    vi.mocked(lib.guardarCorteVendedor).mockReturnValue(new Promise(() => {}));
    const onVolver = montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    await userEvent.type(buenas("Jamaica 1 L"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Guardar corte" }));
    expect(await screen.findByRole("button", { name: "Guardando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "← Volver a Corte" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(onVolver).not.toHaveBeenCalled();
  });

  it("sin piezas pregunta si el vendedor no regresó ninguna; Cancelar no guarda", async () => {
    vi.mocked(lib.guardarCorteVendedor).mockResolvedValue(
      corte(SIN_CORTE.lineas, { en: "x", por: "Ana" }),
    );
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    await userEvent.click(screen.getByRole("button", { name: "Guardar corte" }));
    const pregunta = await screen.findByRole("alertdialog");
    expect(
      within(pregunta).getByText("¿El vendedor no regresó ninguna pieza?"),
    ).toBeInTheDocument();
    await userEvent.click(within(pregunta).getByRole("button", { name: "Cancelar" }));
    expect(lib.guardarCorteVendedor).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Guardar corte" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Guardar corte",
      }),
    );
    await waitFor(() => expect(lib.guardarCorteVendedor).toHaveBeenCalledTimes(1));
    expect(vi.mocked(lib.guardarCorteVendedor).mock.calls[0][0].lineas).toEqual([
      { presentacionId: "p1", buenas: 0, merma: 0 },
      { presentacionId: "p2", buenas: 0, merma: 0 },
    ]);
  });

  it("un texto que no es entero bloquea Guardar", async () => {
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    await userEvent.type(merma("Jamaica 1 L"), "x");
    expect(screen.getByText("Solo piezas enteras")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar corte" })).toBeDisabled();
  });

  it("Agregar presentación ofrece las vivas que no están y se manda al guardar", async () => {
    vi.mocked(lib.guardarCorteVendedor).mockResolvedValue(
      corte(SIN_CORTE.lineas, { en: "x", por: "Ana" }),
    );
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    const lista = await screen.findByLabelText("Agregar presentación");
    await waitFor(() =>
      expect(
        within(lista).getByRole("option", { name: "Jamaica 500 ml" }),
      ).toBeInTheDocument(),
    );
    expect(within(lista).queryByRole("option", { name: "Jamaica 1 L" })).toBeNull();
    await userEvent.selectOptions(lista, "Jamaica 500 ml");
    await userEvent.click(screen.getByRole("button", { name: "Agregar" }));
    await userEvent.type(buenas("Jamaica 500 ml"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Guardar corte" }));
    expect(vi.mocked(lib.guardarCorteVendedor).mock.calls[0][0].lineas).toContainEqual({
      presentacionId: "p3",
      buenas: 2,
      merma: 0,
    });
  });

  it("salir con cambios pregunta; sin cambios sale directo", async () => {
    const onVolver = montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onVolver).toHaveBeenCalledTimes(1);

    await userEvent.type(buenas("Jamaica 1 L"), "4");
    await userEvent.click(screen.getByRole("button", { name: "← Volver a Corte" }));
    const pregunta = await screen.findByRole("alertdialog");
    expect(within(pregunta).getByText("¿Descartar los cambios?")).toBeInTheDocument();
    await userEvent.click(within(pregunta).getByRole("button", { name: "Cancelar" }));
    expect(onVolver).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "← Volver a Corte" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Descartar",
      }),
    );
    expect(onVolver).toHaveBeenCalledTimes(2);
  });

  it("un error al guardar se muestra y no pierde lo escrito", async () => {
    const { ErrorApi } = await import("@/lib/api");
    vi.mocked(lib.guardarCorteVendedor).mockRejectedValue(
      new ErrorApi("x", 400, "La fecha no puede ser posterior a hoy."),
    );
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    await userEvent.type(buenas("Jamaica 1 L"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Guardar corte" }));
    expect(
      await screen.findByText("La fecha no puede ser posterior a hoy."),
    ).toBeInTheDocument();
    expect(buenas("Jamaica 1 L")).toHaveValue("4");
  });
});

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

const linea = (id: string, nombre: string, m: Partial<LineaCorte> = {}): LineaCorte => {
  const base = { cargadas: 10, vendidas: 4, regaladas: 1, buenas: 0, merma: 0, faltante: null, ...m };
  return { presentacionId: id, nombre, deberiaRegresar: base.cargadas - base.vendidas - base.regaladas, ...base };
};

const corte = (lineas: LineaCorte[], hecho: Corte["hecho"] = null): Corte => ({
  fecha: FECHA,
  hoy: "2026-11-12",
  vendedor: VENDEDOR,
  sucursal: { id: "s", codigo: "TJ" },
  lineas,
  totales: {
    cargadas: lineas.reduce((t, l) => t + l.cargadas, 0),
    vendidas: lineas.reduce((t, l) => t + l.vendidas, 0),
    regaladas: lineas.reduce((t, l) => t + l.regaladas, 0),
    deberiaRegresar: lineas.reduce((t, l) => t + l.deberiaRegresar, 0),
    buenas: lineas.reduce((t, l) => t + l.buenas, 0),
    merma: lineas.reduce((t, l) => t + l.merma, 0),
    faltante: hecho ? lineas.reduce((t, l) => t + Math.max(l.faltante ?? 0, 0), 0) : null,
  },
  hecho,
});

const SIN_CORTE = corte([
  linea("p1", "Jamaica 1 L"),
  linea("p2", "Horchata 1 L", { cargadas: 0, vendidas: 3, regaladas: 0 }),
]);

const buenas = (nombre: string) => screen.getByLabelText(`Buenas de ${nombre}`);
const merma = (nombre: string) => screen.getByLabelText(`Merma de ${nombre}`);
const renglon = (nombre: string) => within(screen.getByRole("row", { name: new RegExp(nombre) }));

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
        id: "a", nombre: "Jamaica", activo: true,
        presentaciones: [{ id: "p1", volumen: "1 L" }, { id: "p3", volumen: "500 ml" }],
      },
    ]);
  });

  it("pide el corte del vendedor y pinta la tabla con los campos vacíos (nunca el teórico)", async () => {
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    expect(lib.leerCorteVendedor).toHaveBeenCalledWith(FECHA, "v1");
    expect(screen.getByRole("heading", { name: "Corte · Ana Pérez" })).toBeInTheDocument();
    for (const t of ["Presentación", "Cargadas", "Vendidas", "Regaladas", "Debería regresar", "Buenas", "Merma", "Faltante"]) {
      expect(screen.getByRole("columnheader", { name: t })).toBeInTheDocument();
    }
    expect(buenas("Jamaica 1 L")).toHaveValue("");
    expect(merma("Jamaica 1 L")).toHaveValue("");
    expect(renglon("Jamaica 1 L").getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Sin corte")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Debería regresar = cargadas − vendidas − regaladas. La merma, los cambios y el consumo de la tablet se restarán cuando la app los registre.",
      ),
    ).toBeInTheDocument();
  });

  it("debería negativo lleva el aviso Vendió más de lo cargado", async () => {
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    expect(renglon("Horchata 1 L").getByText("Vendió más de lo cargado")).toBeInTheDocument();
    expect(renglon("Horchata 1 L").getByText("-3")).toBeInTheDocument();
    expect(renglon("Jamaica 1 L").queryByText("Vendió más de lo cargado")).toBeNull();
  });

  it("un corte hecho trae lo guardado, quién lo hizo, el faltante en rojo y Faltan N en el total", async () => {
    vi.mocked(lib.leerCorteVendedor).mockResolvedValue(
      corte(
        [
          linea("p1", "Jamaica 1 L", { buenas: 3, merma: 1, faltante: 2 }),
          linea("p2", "Horchata 1 L", { cargadas: 5, vendidas: 0, regaladas: 0, buenas: 7, faltante: -2 }),
        ],
        { en: "2026-11-11T22:00:00Z", por: "Luis Almacén" },
      ),
    );
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    expect(buenas("Jamaica 1 L")).toHaveValue("3");
    expect(merma("Jamaica 1 L")).toHaveValue("1");
    expect(screen.getByText("Faltan 2", { selector: "[data-tono]" })).toBeInTheDocument();
    expect(screen.getByText(/Hecho por Luis Almacén/)).toBeInTheDocument();
    expect(renglon("Jamaica 1 L").getByText("2")).toHaveClass("text-destructive");
    expect(renglon("Horchata 1 L").getByText("Sobran 2")).not.toHaveClass("text-destructive");
    // El total suma solo lo que falta: un sobrante no compensa.
    expect(renglon("Total").getByText("Faltan 2")).toHaveClass("text-destructive");
  });

  it("Guardar corte manda todas las líneas con vacío = 0 y avisa", async () => {
    vi.mocked(lib.guardarCorteVendedor).mockResolvedValue(
      corte([linea("p1", "Jamaica 1 L", { buenas: 5, faltante: 0 })], { en: "2026-11-11T22:00:00Z", por: "Ana" }),
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

  it("sin corte, solo el renglón tocado muestra su faltante y el total queda vacío (D9)", async () => {
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    await userEvent.type(buenas("Jamaica 1 L"), "3");
    expect(renglon("Jamaica 1 L").getByText("2")).toHaveClass("text-destructive");
    // Horchata (debería −3) no se tocó: no sale como sobrante.
    expect(renglon("Horchata 1 L").queryByText(/Sobran/)).toBeNull();
    expect(renglon("Total").queryByText(/Faltan/)).toBeNull();
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
    vi.mocked(lib.guardarCorteVendedor).mockResolvedValue(corte(SIN_CORTE.lineas, { en: "x", por: "Ana" }));
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    await userEvent.click(screen.getByRole("button", { name: "Guardar corte" }));
    const pregunta = await screen.findByRole("alertdialog");
    expect(within(pregunta).getByText("¿El vendedor no regresó ninguna pieza?")).toBeInTheDocument();
    await userEvent.click(within(pregunta).getByRole("button", { name: "Cancelar" }));
    expect(lib.guardarCorteVendedor).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Guardar corte" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Guardar corte" }));
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
    vi.mocked(lib.guardarCorteVendedor).mockResolvedValue(corte(SIN_CORTE.lineas, { en: "x", por: "Ana" }));
    montar();
    await screen.findByRole("table", { name: "Corte del vendedor" });
    const lista = await screen.findByLabelText("Agregar presentación");
    await waitFor(() => expect(within(lista).getByRole("option", { name: "Jamaica 500 ml" })).toBeInTheDocument());
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
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }));
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
    expect(await screen.findByText("La fecha no puede ser posterior a hoy.")).toBeInTheDocument();
    expect(buenas("Jamaica 1 L")).toHaveValue("4");
  });
});

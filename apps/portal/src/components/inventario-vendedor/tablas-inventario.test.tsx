import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  InventarioVendedor,
  LineaInventario,
  RecargaInventario,
} from "@/lib/inventario-vendedor";
import { TablasInventario } from "./tablas-inventario";

const linea = (m: Partial<LineaInventario> = {}): LineaInventario => ({
  presentacionId: "p1",
  nombre: "Horchata 1 L",
  producto: "Horchata",
  volumen: "1 L",
  cargadas: 40,
  vendidas: 30,
  regaladas: 2,
  mermaEntregada: 1,
  mermaRecibida: 3,
  mermaAlmacen: 2,
  consumo: 1,
  cambiosEntregados: 0,
  cambiosRecibidos: 0,
  deberiaRegresar: 4,
  buenas: 3,
  faltante: 1,
  merma: 5,
  mermaTeorica: 5,
  resultadoMerma: 0,
  ...m,
});

const recarga = (m: Partial<RecargaInventario> = {}): RecargaInventario => ({
  cargaId: "c1",
  numero: 1,
  vendedorId: "v1",
  vendedor: "Luis",
  presentacionId: "p1",
  nombre: "Horchata 1 L",
  producto: "Horchata",
  volumen: "1 L",
  piezas: 40,
  capturo: "Ana",
  hora: "07:29",
  estado: "aceptada",
  motivoRechazo: null,
  aceptada: true,
  renglonesAceptados: 1,
  renglones: 1,
  ...m,
});

const datos = (m: Partial<InventarioVendedor> = {}): InventarioVendedor => ({
  fecha: "2026-11-23",
  hoy: "2026-11-24",
  sucursal: { id: "s", codigo: "TJ" },
  vendedor: { id: "v1", nombre: "Luis" },
  lineas: [linea()],
  totales: {} as InventarioVendedor["totales"],
  recargas: [recarga()],
  vendedoresSinCorte: 0,
  corte: { estado: "hecho", piezasFaltantes: 1, mermaFaltante: 0 },
  ...m,
});

describe("TablasInventario", () => {
  it("Inventario: encabezados de dos niveles y total por tamaño", () => {
    render(<TablasInventario datos={datos()} />);
    const tabla = screen.getByRole("table", { name: "Inventario" });
    for (const t of [
      "Producto",
      "Operación del vendedor",
      "Validación por almacén",
      "Piezas cargadas",
      "Ventas",
      "Merma registrada en sistema",
      "Cambio físico entregado",
      "Cambio físico recibido",
      "Promoción",
      "Consumo",
      "Piezas teóricas por regresar",
      "Piezas reales retornadas",
      "Resultado",
    ])
      expect(within(tabla).getAllByText(t).length).toBeGreaterThan(0);
    expect(within(tabla).getByText("Total 1 L")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Merma registrada en sistema/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Cambio físico/ }),
    ).toHaveLength(2);
  });

  it("Inventario: sin corte, piezas reales y resultado salen vacíos (no 0); con corte, > 0 en rojo", () => {
    const { rerender } = render(
      <TablasInventario
        datos={datos({
          lineas: [linea({ buenas: null, faltante: null })],
        })}
      />,
    );
    const fila = screen.getByRole("cell", { name: "Horchata" }).closest("tr")!;
    const celdas = within(fila).getAllByRole("cell");
    expect(celdas).toHaveLength(11);
    expect(celdas[9].textContent).toBe("");
    expect(celdas[10].textContent).toBe("");
    rerender(<TablasInventario datos={datos()} />);
    const fila2 = screen.getByRole("cell", { name: "Horchata" }).closest("tr")!;
    const c2 = within(fila2).getAllByRole("cell");
    expect(c2[10]).toHaveTextContent("1");
    expect(within(c2[10]).getByText("1")).toHaveClass("text-destructive");
  });

  it("Inventario con Todos y vendedores sin corte avisa", () => {
    render(
      <TablasInventario datos={datos({ vendedor: null, vendedoresSinCorte: 2 })} />,
    );
    expect(
      screen.getByText(
        "2 vendedores sin corte: no entran en la validación por almacén.",
      ),
    ).toBeInTheDocument();
  });

  it("sin vendedores sin corte no hay aviso", () => {
    render(<TablasInventario datos={datos({ vendedor: null })} />);
    expect(screen.queryByText(/sin corte/)).not.toBeInTheDocument();
  });

  it("vacío: mensaje en lugar de renglones", () => {
    render(<TablasInventario datos={datos({ lineas: [], recargas: [] })} />);
    expect(
      screen.getByText("Sin carga aceptada ni venta ese día."),
    ).toBeInTheDocument();
  });

  it("vacío propio de cada pestaña", async () => {
    render(<TablasInventario datos={datos({ lineas: [], recargas: [] })} />);
    await userEvent.click(screen.getByRole("tab", { name: "Recargas" }));
    expect(screen.getByText("No hubo recargas ese día.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Merma" }));
    expect(
      screen.getByText("Sin carga aceptada ni venta ese día."),
    ).toBeInTheDocument();
  });

  it("teóricas null (Todos sin corte) salen vacías", async () => {
    render(
      <TablasInventario
        datos={datos({
          vendedor: null,
          lineas: [linea({ deberiaRegresar: null, mermaTeorica: null, buenas: null, faltante: null, merma: null, resultadoMerma: null })],
        })}
      />,
    );
    const celdas = within(
      screen.getByRole("cell", { name: "Horchata" }).closest("tr")!,
    ).getAllByRole("cell");
    expect(celdas[8].textContent).toBe("");
    await userEvent.click(screen.getByRole("tab", { name: "Merma" }));
    const c = within(
      screen.getByRole("cell", { name: "Horchata" }).closest("tr")!,
    ).getAllByRole("cell");
    expect(c[3].textContent).toBe("");
  });

  it("Merma: encabezados y resultado", async () => {
    render(<TablasInventario datos={datos()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Merma" }));
    const tabla = screen.getByRole("table", { name: "Merma" });
    for (const t of [
      "Merma recibida del cliente",
      "Merma de almacén",
      "Merma teórica por regresar",
      "Merma real validada",
      "Resultado",
    ])
      expect(within(tabla).getAllByText(t).length).toBeGreaterThan(0);
    expect(within(tabla).getByText("Total 1 L")).toBeInTheDocument();
  });

  it("Recargas: una carga parcial dice Aceptada N de M y una rechazada sin motivo no pinta Motivo", async () => {
    const r = [
      recarga({ aceptada: true, renglonesAceptados: 2, renglones: 3 }),
      recarga({
        cargaId: "c2",
        estado: "rechazada",
        aceptada: false,
        renglonesAceptados: 0,
        renglones: 1,
      }),
    ];
    render(<TablasInventario datos={datos({ recargas: r })} />);
    await userEvent.click(screen.getByRole("tab", { name: "Recargas" }));
    const tabla = screen.getByRole("table", { name: "Recargas" });
    expect(within(tabla).getByText("Aceptada 2 de 3")).toBeInTheDocument();
    expect(within(tabla).getByText("Rechazada")).toBeInTheDocument();
    expect(within(tabla).queryByText(/Motivo/)).not.toBeInTheDocument();
  });

  it("Recargas: el renglón no aceptado de una carga parcial dice No aceptado y se tiñe", async () => {
    const r = [
      recarga({ aceptada: true, renglonesAceptados: 1, renglones: 2 }),
      recarga({
        presentacionId: "p2",
        nombre: "Otro",
        aceptada: false,
        renglonesAceptados: 1,
        renglones: 2,
      }),
    ];
    render(<TablasInventario datos={datos({ recargas: r })} />);
    await userEvent.click(screen.getByRole("tab", { name: "Recargas" }));
    const tabla = screen.getByRole("table", { name: "Recargas" });
    const no = within(tabla).getByText("No aceptado");
    expect(no.closest("tr")).toHaveClass("bg-destructive-soft/40");
    const si = within(tabla).getByText("Aceptada 1 de 2");
    expect(si.closest("tr")).not.toHaveClass("bg-destructive-soft/40");
  });

  it("Recargas: hora, estado y motivo; Vendedor solo con Todos", async () => {
    const r = [
      recarga(),
      recarga({
        cargaId: "c2",
        numero: 2,
        estado: "rechazada",
        aceptada: false,
        renglonesAceptados: 0,
        motivoRechazo: "No cuadra",
        hora: "13:05",
      }),
    ];
    const { rerender } = render(<TablasInventario datos={datos({ recargas: r })} />);
    await userEvent.click(screen.getByRole("tab", { name: "Recargas" }));
    const tabla = screen.getByRole("table", { name: "Recargas" });
    expect(within(tabla).getByText("7:29 a. m.")).toBeInTheDocument();
    expect(within(tabla).getByText("1:05 p. m.")).toBeInTheDocument();
    expect(within(tabla).getByText("Aceptada")).toBeInTheDocument();
    expect(within(tabla).getByText("Rechazada")).toBeInTheDocument();
    expect(within(tabla).getByText(/No cuadra/)).toBeInTheDocument();
    expect(within(tabla).getAllByText("Ana").length).toBe(2);
    expect(
      within(tabla).queryByRole("columnheader", { name: "Vendedor" }),
    ).not.toBeInTheDocument();
    rerender(<TablasInventario datos={datos({ vendedor: null, recargas: r })} />);
    expect(
      within(screen.getByRole("table", { name: "Recargas" })).getByRole(
        "columnheader",
        { name: "Vendedor" },
      ),
    ).toBeInTheDocument();
  });

  it("pie 'Faltantes del día' en Inventario y Merma; vacío con null o 0", async () => {
    const totales = (faltante: number | null, faltanteMerma: number | null) =>
      ({ faltante, faltanteMerma }) as InventarioVendedor["totales"];
    const { rerender } = render(<TablasInventario datos={datos({ totales: totales(7, 2) })} />);
    const pie = () => within(screen.getByRole("table", { name: /Inventario|Merma/ })).getByText("Faltantes del día").closest("tr")!;
    expect(within(pie()).getByText("Faltan: 7 pz p/Almacen")).toHaveClass("text-destructive");
    await userEvent.click(screen.getByRole("tab", { name: "Merma" }));
    expect(within(pie()).getByText("Faltan: 2 pz merma")).toHaveClass("text-destructive");
    rerender(<TablasInventario datos={datos({ totales: totales(null, 0) })} />);
    expect(within(pie()).queryByText(/^Faltan? \d/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Inventario" }));
    expect(within(pie()).queryByText(/^Faltan? \d/)).not.toBeInTheDocument();
    rerender(<TablasInventario datos={datos({ totales: totales(1, 1) })} />);
    expect(within(pie()).getByText("Faltan: 1 pz p/Almacen")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Merma" }));
    expect(within(pie()).getByText("Faltan: 1 pz merma")).toBeInTheDocument();
  });

  it("resultado negativo sin rojo; resultadoMerma null vacío", async () => {
    render(
      <TablasInventario
        datos={datos({ lineas: [linea({ faltante: -2, resultadoMerma: null })] })}
      />,
    );
    const fila = screen.getByRole("cell", { name: "Horchata" }).closest("tr")!;
    const neg = within(fila).getByText("-2");
    expect(neg).not.toHaveClass("text-destructive");
    await userEvent.click(screen.getByRole("tab", { name: "Merma" }));
    const f2 = screen.getByRole("cell", { name: "Horchata" }).closest("tr")!;
    const c = within(f2).getAllByRole("cell");
    expect(c[5].textContent).toBe("");
  });

  it("aviso en singular", () => {
    render(<TablasInventario datos={datos({ vendedor: null, vendedoresSinCorte: 1 })} />);
    expect(
      screen.getByText("1 vendedor sin corte: no entran en la validación por almacén."),
    ).toBeInTheDocument();
  });
});

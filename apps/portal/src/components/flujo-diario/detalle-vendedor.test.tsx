import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DetalleVendedorDia } from "@/lib/flujo-diario";
import { DetalleVendedor } from "./detalle-vendedor";

const DETALLE: DetalleVendedorDia = {
  fecha: "2026-11-09",
  vendedorId: "ricardo",
  vendedor: "Ricardo",
  porProducto: [
    { presentacion: "600 ml", producto: "Peñafiel 600 ml", piezas: 390 },
    { presentacion: "500 ml", producto: "Agua 500 ml", piezas: 180 },
    { presentacion: "500 ml", producto: "Jamaica 500 ml", piezas: 60 },
  ],
  notas: [
    {
      folio: "TJ261109RB07", cliente: "5 Esquinas", contadoCredito: "contado", piezas: 40, totalCentavos: 46000,
      pendienteCentavos: 0,
      lineas: [
        { producto: "Horchata 500 ml", cantidad: 20, precioCentavos: 1150 },
        { producto: "Jamaica 500 ml", cantidad: 20, precioCentavos: 1150 },
      ],
    },
    {
      folio: "TJ261109RB10", cliente: "Don Gallo", contadoCredito: "credito", piezas: 80, totalCentavos: 92000,
      pendienteCentavos: 92000, lineas: [{ producto: "Horchata 500 ml", cantidad: 80, precioCentavos: 1150 }],
    },
  ],
  cobranza: {
    contado: [
      { folio: "TJ261109RB07", cliente: "5 Esquinas", montoCentavos: 46000, metodo: "efectivo", saldoPendienteCentavos: 0, liquidada: true },
    ],
    anteriores: [
      { folio: "TJ261031RA33", cliente: "mariscos titanic", montoCentavos: 25000, metodo: "transferencia", saldoPendienteCentavos: 15000, liquidada: false },
    ],
    aFavor: [{ cliente: "Aqui es Texcoco", montoCentavos: 5000 }],
  },
  gastos: [{ descripcion: "Hielo", montoCentavos: 1000 }],
  notasCredito: [{ folio: "TJ261109RB10", cliente: "Don Gallo", totalCentavos: 92000, pendienteCentavos: 92000 }],
  visitas: [
    { cliente: "Tyco Cge", vendio: true, hora: "2026-11-09T16:42:00.000Z", motivo: null, atendio: null, comentario: null },
    { cliente: "Abarrotes Mary", vendio: false, hora: "2026-11-09T17:15:00.000Z", motivo: "Tiene producto", atendio: "Mary", comentario: "Pasar el jueves" },
  ],
  promociones: [{ cliente: "Don Gallo", producto: "Horchata 500 ml", cantidad: 4 }],
  corte: null,
};

describe("DetalleVendedor", () => {
  it("Venta general: Por producto agrupado por presentación; el selector pasa a Por cliente", async () => {
    const u = userEvent.setup();
    render(<DetalleVendedor detalle={DETALLE} modo="flujo" />);
    expect(screen.getByRole("radio", { name: "Por producto" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("600 ml · 390")).toBeInTheDocument();
    expect(screen.getByText("500 ml · 240")).toBeInTheDocument();
    expect(screen.getByText("Peñafiel 600 ml")).toBeInTheDocument();
    await u.click(screen.getByRole("radio", { name: "Por cliente" }));
    expect(screen.getByRole("radio", { name: "Por cliente" })).toHaveAttribute("aria-checked", "true");
    const tabla = screen.getByRole("table", { name: "Por cliente" });
    expect(within(tabla).getByText("Don Gallo")).toBeInTheDocument();
    expect(within(tabla).getByText("Crédito")).toBeInTheDocument();
    // La nota se abre a sus productos.
    await u.click(within(tabla).getByRole("button", { name: /TJ261109RB07/ }));
    expect(screen.getByText("Horchata 500 ml × 20 a $11.50 · Jamaica 500 ml × 20 a $11.50")).toBeInTheDocument();
  });

  it("Cobranza: Sí, Abonado con lo que resta, el método si no es efectivo y lo que quedó a favor", async () => {
    const u = userEvent.setup();
    render(<DetalleVendedor detalle={DETALLE} modo="flujo" />);
    await u.click(screen.getByRole("tab", { name: "Cobranza" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Sí")).toBeInTheDocument();
    expect(within(panel).getByText("Abonado")).toBeInTheDocument();
    expect(within(panel).getByText("resta $150.00")).toBeInTheDocument();
    expect(within(panel).getByText("Transferencia")).toBeInTheDocument();
    expect(within(panel).queryByText("Efectivo")).not.toBeInTheDocument();
    expect(within(panel).getByText("Quedó a favor del cliente · $50.00")).toBeInTheDocument();
    expect(within(panel).getByText("Aqui es Texcoco")).toBeInTheDocument();
    // Total = contado + anteriores + a favor.
    expect(within(panel).getByText("$760.00")).toBeInTheDocument();
  });

  it("modo flujo no tiene Corte; Inventario está deshabilitada", () => {
    render(<DetalleVendedor detalle={DETALLE} modo="flujo" />);
    expect(screen.queryByRole("tab", { name: "Corte" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Inventario · pronto" })).toHaveAttribute("aria-disabled", "true");
  });

  it("modo dashboard sin corte: el vendedor no ha terminado su ruta", async () => {
    const u = userEvent.setup();
    render(<DetalleVendedor detalle={DETALLE} modo="dashboard" />);
    await u.click(screen.getByRole("tab", { name: "Corte" }));
    expect(screen.getByText("El vendedor no ha terminado su ruta.")).toBeInTheDocument();
  });

  it("modo dashboard con corte: Tesorería y el renglón a favor solo si hay", async () => {
    const u = userEvent.setup();
    const corte = { contadoCentavos: 187400, anterioresCentavos: 92250, aFavorCentavos: 0, gastoCentavos: 1000, tesoreriaCentavos: 278650 };
    const { unmount } = render(<DetalleVendedor detalle={{ ...DETALLE, corte }} modo="dashboard" />);
    await u.click(screen.getByRole("tab", { name: "Corte" }));
    const tabla = screen.getByRole("table", { name: "Corte" });
    expect(within(tabla).getByText("$2,786.50")).toBeInTheDocument();
    expect(within(tabla).getByText("− $10.00")).toBeInTheDocument();
    expect(within(tabla).queryByText("Quedó a favor del cliente")).not.toBeInTheDocument();
    unmount();
    render(<DetalleVendedor detalle={{ ...DETALLE, corte: { ...corte, aFavorCentavos: 5000 } }} modo="dashboard" />);
    await u.click(screen.getByRole("tab", { name: "Corte" }));
    expect(within(screen.getByRole("table", { name: "Corte" })).getByText("Quedó a favor del cliente")).toBeInTheDocument();
  });

  it("Visitas en hora de Tijuana; Notas de venta y promociones por cliente", async () => {
    const u = userEvent.setup();
    render(<DetalleVendedor detalle={DETALLE} modo="flujo" />);
    await u.click(screen.getByRole("tab", { name: "Visitas" }));
    expect(screen.getByText("8:42")).toBeInTheDocument();
    expect(screen.getByText("Pasar el jueves")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Notas de venta" }));
    expect(within(screen.getByRole("tabpanel")).getByText("TJ261109RB10")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Mermas, cambios y promociones" }));
    expect(within(screen.getByRole("tabpanel")).getByText("Don Gallo")).toBeInTheDocument();
  });

  it("sin datos: los textos de vacío", async () => {
    const u = userEvent.setup();
    const vacio: DetalleVendedorDia = { ...DETALLE, notasCredito: [], promociones: [] };
    render(<DetalleVendedor detalle={vacio} modo="flujo" />);
    await u.click(screen.getByRole("tab", { name: "Notas de venta" }));
    expect(screen.getByText("Sin notas a crédito este día.")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Mermas, cambios y promociones" }));
    expect(screen.getByText("Sin promociones este día.")).toBeInTheDocument();
  });
});

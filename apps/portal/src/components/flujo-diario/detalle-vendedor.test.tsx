import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as fd from "@/lib/flujo-diario";
import type { DetalleVendedorDia } from "@/lib/flujo-diario";
import { DetalleVendedor } from "./detalle-vendedor";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/flujo-diario", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/flujo-diario")>();
  return { ...real, guardarNotasEntregadas: vi.fn() };
});
const guardarNotasEntregadas = vi.mocked(fd.guardarNotasEntregadas);

function mockAuth(permisos: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: null,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}

beforeEach(() => {
  guardarNotasEntregadas.mockReset();
  mockAuth(["nota_papel.revisar"]);
});

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
  notasCredito: [{ folio: "TJ261109RB10", cliente: "Don Gallo", totalCentavos: 92000, pendienteCentavos: 92000, entregada: null }],
  notasNoEntregadas: [],
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
    // Como el sistema viejo: el folio va primero.
    expect(within(tabla).getAllByRole("columnheader")[0]).toHaveTextContent("Folio");
    expect(within(tabla).getByText("Don Gallo")).toBeInTheDocument();
    expect(within(tabla).getByText("Crédito")).toBeInTheDocument();
    // La nota se abre a sus productos, en una tablita con cantidad, precio e importe.
    const folio = within(tabla).getByRole("button", { name: /TJ261109RB07/ });
    expect(folio).toHaveAttribute("aria-expanded", "false");
    await u.click(folio);
    expect(folio).toHaveAttribute("aria-expanded", "true");
    const productos = screen.getByRole("table", { name: "Productos de TJ261109RB07" });
    const filas = within(productos).getAllByRole("row");
    expect(filas[1]).toHaveTextContent("Horchata 500 ml");
    expect(filas[1]).toHaveTextContent("20");
    // Como el viejo: en Ventas por cliente solo Producto y Cantidad.
    expect(within(productos).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Producto", "Cantidad"]);
    // Picar el folio otra vez la cierra; picar en cualquier parte del renglón también la abre.
    await u.click(folio);
    expect(screen.queryByRole("table", { name: "Productos de TJ261109RB07" })).not.toBeInTheDocument();
    await u.click(within(tabla).getByText("5 Esquinas"));
    expect(screen.getByRole("table", { name: "Productos de TJ261109RB07" })).toBeInTheDocument();
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
    // Como el viejo: una lista debajo de la otra, cada una con su renglón Total.
    const tablas = within(panel).getAllByRole("table").map((t) => t.getAttribute("aria-label"));
    expect(tablas).toEqual(["Cobranza ventas de contado", "Cobranza ventas anteriores", "Quedó a favor del cliente"]);
    const contado = within(panel).getByRole("table", { name: "Cobranza ventas de contado" });
    expect(within(contado).getAllByRole("row").at(-1)).toHaveTextContent("Total$460.00");
    const anteriores = within(panel).getByRole("table", { name: "Cobranza ventas anteriores" });
    expect(within(anteriores).getAllByRole("row").at(-1)).toHaveTextContent("Total$250.00");
    // En la cobranza el folio de contado se abre a Producto · Cantidad · Precio, como el viejo.
    await u.click(within(contado).getByRole("button", { name: /TJ261109RB07/ }));
    const productos = screen.getByRole("table", { name: "Productos de TJ261109RB07" });
    expect(within(productos).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Producto", "Cantidad", "Precio"]);
    expect(within(productos).getAllByRole("row")[1]).toHaveTextContent("$11.50");
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
    // Las palabras del corte del sistema viejo.
    expect(within(tabla).getByText("Ventas contado")).toBeInTheDocument();
    expect(within(tabla).getByText("Ventas anteriores")).toBeInTheDocument();
    unmount();
    render(<DetalleVendedor detalle={{ ...DETALLE, corte: { ...corte, aFavorCentavos: 5000 } }} modo="dashboard" />);
    await u.click(screen.getByRole("tab", { name: "Corte" }));
    expect(within(screen.getByRole("table", { name: "Corte" })).getByText("Quedó a favor del cliente")).toBeInTheDocument();
  });

  it("Visitas en hora de Tijuana; Notas de ventas y promociones por cliente", async () => {
    const u = userEvent.setup();
    render(<DetalleVendedor detalle={DETALLE} modo="flujo" />);
    await u.click(screen.getByRole("tab", { name: "Visitas" }));
    expect(screen.getByText("8:42")).toBeInTheDocument();
    expect(screen.getByText("Pasar el jueves")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    expect(within(screen.getByRole("tabpanel")).getByText("TJ261109RB10")).toBeInTheDocument();
    // Las palabras del sistema viejo: título y columnas Cliente · Folio · Monto · Pendiente.
    // Sin revisar (null) cuenta como NO entregada.
    expect(screen.getByText("Notas nuevas NO entregadas")).toBeInTheDocument();
    const notas = screen.getByRole("table", { name: "Notas nuevas NO entregadas" });
    expect(within(notas).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Cliente",
      "Folio",
      "Monto",
      "Pendiente",
    ]);
    await u.click(screen.getByRole("tab", { name: "Mermas/Cambios/Promociones" }));
    expect(within(screen.getByRole("tabpanel")).getByText("Don Gallo")).toBeInTheDocument();
  });

  it("en el Dashboard las notas nuevas son las que faltan por entregar, con su casilla Entregada", async () => {
    const u = userEvent.setup();
    const detalle: DetalleVendedorDia = {
      ...DETALLE,
      notasCredito: [
        { folio: "TJ261109RB10", cliente: "Don Gallo", totalCentavos: 92000, pendienteCentavos: 92000, entregada: null },
        { folio: "TJ261109RB11", cliente: "Mary", totalCentavos: 10000, pendienteCentavos: 5000, entregada: true },
      ],
    };
    render(<DetalleVendedor detalle={detalle} modo="dashboard" />);
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    const tabla = screen.getByRole("table", { name: "Notas pendientes nuevas por entregar" });
    expect(within(tabla).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Cliente",
      "Folio",
      "Monto",
      "Pendiente",
      "Entregada",
    ]);
    // Empieza con lo guardado: null = sin marcar.
    expect(within(tabla).getByRole("checkbox", { name: "Entregada TJ261109RB10" })).not.toBeChecked();
    expect(within(tabla).getByRole("checkbox", { name: "Entregada TJ261109RB11" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Guardar revisión" })).toBeInTheDocument();
    // Sin notas NO entregadas de días anteriores, esa lista no sale.
    expect(screen.queryByText("Notas nuevas NO entregadas")).not.toBeInTheDocument();
  });

  it("Guardar revisión manda todas las casillas y avisa para volver a pedir el detalle", async () => {
    const u = userEvent.setup();
    const guardadas = vi.fn();
    guardarNotasEntregadas.mockResolvedValue(undefined);
    const detalle: DetalleVendedorDia = {
      ...DETALLE,
      notasCredito: [
        { folio: "TJ261109RB10", cliente: "Don Gallo", totalCentavos: 92000, pendienteCentavos: 92000, entregada: null },
        { folio: "TJ261109RB11", cliente: "Mary", totalCentavos: 10000, pendienteCentavos: 5000, entregada: true },
      ],
    };
    render(<DetalleVendedor detalle={detalle} modo="dashboard" onNotasGuardadas={guardadas} />);
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    await u.click(screen.getByRole("checkbox", { name: "Entregada TJ261109RB10" }));
    await u.click(screen.getByRole("checkbox", { name: "Entregada TJ261109RB11" }));
    await u.click(screen.getByRole("button", { name: "Guardar revisión" }));
    expect(guardarNotasEntregadas).toHaveBeenCalledWith({
      vendedor: "ricardo",
      notas: [
        { folio: "TJ261109RB10", entregada: true },
        { folio: "TJ261109RB11", entregada: false },
      ],
    });
    await waitFor(() => expect(guardadas).toHaveBeenCalledTimes(1));
  });

  it("si Guardar falla, avisa el error y no recarga", async () => {
    const u = userEvent.setup();
    const guardadas = vi.fn();
    guardarNotasEntregadas.mockRejectedValue(new ErrorApi("x", 400, "La nota TJ261109RB10 no se puede revisar."));
    render(<DetalleVendedor detalle={DETALLE} modo="dashboard" onNotasGuardadas={guardadas} />);
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    await u.click(screen.getByRole("checkbox", { name: "Entregada TJ261109RB10" }));
    await u.click(screen.getByRole("button", { name: "Guardar revisión" }));
    expect(await screen.findByText("La nota TJ261109RB10 no se puede revisar.")).toBeInTheDocument();
    expect(guardadas).not.toHaveBeenCalled();
  });

  it("Guardar y Cancelar empiezan deshabilitados; Cancelar regresa las casillas a lo guardado", async () => {
    const u = userEvent.setup();
    const detalle: DetalleVendedorDia = {
      ...DETALLE,
      notasCredito: [
        { folio: "TJ261109RB10", cliente: "Don Gallo", totalCentavos: 92000, pendienteCentavos: 92000, entregada: null },
        { folio: "TJ261109RB11", cliente: "Mary", totalCentavos: 10000, pendienteCentavos: 5000, entregada: true },
      ],
    };
    render(<DetalleVendedor detalle={detalle} modo="dashboard" />);
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    const guardarBtn = screen.getByRole("button", { name: "Guardar revisión" });
    const cancelar = screen.getByRole("button", { name: "Cancelar" });
    expect(guardarBtn).toBeDisabled();
    expect(cancelar).toBeDisabled();
    const rb10 = screen.getByRole("checkbox", { name: "Entregada TJ261109RB10" });
    const rb11 = screen.getByRole("checkbox", { name: "Entregada TJ261109RB11" });
    await u.click(rb10);
    await u.click(rb11);
    expect(guardarBtn).toBeEnabled();
    expect(cancelar).toBeEnabled();
    await u.click(cancelar);
    expect(rb10).not.toBeChecked();
    expect(rb11).toBeChecked();
    expect(guardarBtn).toBeDisabled();
    expect(cancelar).toBeDisabled();
    // Volver a dejar una casilla como estaba tampoco cuenta como cambio.
    await u.click(rb10);
    await u.click(rb10);
    expect(guardarBtn).toBeDisabled();
    expect(guardarNotasEntregadas).not.toHaveBeenCalled();
  });

  it("tras guardar bien, se olvidan las marcas locales y se ve lo que diga el servidor", async () => {
    const u = userEvent.setup();
    guardarNotasEntregadas.mockResolvedValue(undefined);
    const nota = { folio: "TJ261109RB10", cliente: "Don Gallo", totalCentavos: 92000, pendienteCentavos: 92000 };
    const { rerender } = render(
      <DetalleVendedor detalle={{ ...DETALLE, notasCredito: [{ ...nota, entregada: null }] }} modo="dashboard" />,
    );
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    await u.click(screen.getByRole("checkbox", { name: "Entregada TJ261109RB10" }));
    await u.click(screen.getByRole("button", { name: "Guardar revisión" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar revisión" })).toBeDisabled());
    // Llega el detalle nuevo: otra persona la dejó como NO entregada después.
    rerender(<DetalleVendedor detalle={{ ...DETALLE, notasCredito: [{ ...nota, entregada: false }] }} modo="dashboard" />);
    expect(screen.getByRole("checkbox", { name: "Entregada TJ261109RB10" })).not.toBeChecked();
  });

  it("sin nota_papel.revisar: casillas deshabilitadas y sin botón Guardar", async () => {
    const u = userEvent.setup();
    mockAuth([]);
    render(<DetalleVendedor detalle={DETALLE} modo="dashboard" />);
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    expect(screen.getByRole("checkbox", { name: "Entregada TJ261109RB10" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar revisión" })).not.toBeInTheDocument();
  });

  it("Dashboard: debajo, las notas nuevas NO entregadas de días anteriores", async () => {
    const u = userEvent.setup();
    const detalle: DetalleVendedorDia = {
      ...DETALLE,
      notasCredito: [],
      notasNoEntregadas: [
        { folio: "TJ261105RB03", cliente: "Tacos Beto", fecha: "2026-11-05", totalCentavos: 30000, pendienteCentavos: 12000 },
      ],
    };
    render(<DetalleVendedor detalle={detalle} modo="dashboard" />);
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    expect(screen.queryByRole("table", { name: "Notas pendientes nuevas por entregar" })).not.toBeInTheDocument();
    const tabla = screen.getByRole("table", { name: "Notas nuevas NO entregadas" });
    expect(within(tabla).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Cliente",
      "Folio",
      "Fecha",
      "Monto",
      "Pendiente",
    ]);
    expect(within(tabla).getByText("Tacos Beto")).toBeInTheDocument();
    expect(within(tabla).getByText("$120.00")).toBeInTheDocument();
  });

  it("Flujo diario: entregadas y NO entregadas, solo consulta", async () => {
    const u = userEvent.setup();
    const detalle: DetalleVendedorDia = {
      ...DETALLE,
      notasCredito: [
        { folio: "TJ1", cliente: "Uno", totalCentavos: 1000, pendienteCentavos: 1000, entregada: true },
        { folio: "TJ2", cliente: "Dos", totalCentavos: 2000, pendienteCentavos: 2000, entregada: false },
        { folio: "TJ3", cliente: "Tres", totalCentavos: 3000, pendienteCentavos: 3000, entregada: null },
      ],
    };
    render(<DetalleVendedor detalle={detalle} modo="flujo" />);
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    const entregadas = screen.getByRole("table", { name: "Notas pendientes nuevas entregadas" });
    expect(within(entregadas).getByText("TJ1")).toBeInTheDocument();
    expect(within(entregadas).queryByText("TJ2")).not.toBeInTheDocument();
    const no = screen.getByRole("table", { name: "Notas nuevas NO entregadas" });
    expect(within(no).getByText("TJ2")).toBeInTheDocument();
    expect(within(no).getByText("TJ3")).toBeInTheDocument();
    expect(within(no).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Cliente",
      "Folio",
      "Monto",
      "Pendiente",
    ]);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar revisión" })).not.toBeInTheDocument();
  });

  it("Flujo diario: con todas entregadas, no sale la lista de NO entregadas", async () => {
    const u = userEvent.setup();
    const detalle: DetalleVendedorDia = {
      ...DETALLE,
      notasCredito: [{ folio: "TJ1", cliente: "Uno", totalCentavos: 1000, pendienteCentavos: 1000, entregada: true }],
    };
    render(<DetalleVendedor detalle={detalle} modo="flujo" />);
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    expect(screen.getByRole("table", { name: "Notas pendientes nuevas entregadas" })).toBeInTheDocument();
    expect(screen.queryByText("Notas nuevas NO entregadas")).not.toBeInTheDocument();
  });

  it("la cantidad de una promoción lleva separador de miles", async () => {
    const u = userEvent.setup();
    const muchas: DetalleVendedorDia = {
      ...DETALLE,
      promociones: [{ cliente: "Don Gallo", producto: "Horchata 500 ml", cantidad: 1200 }],
    };
    render(<DetalleVendedor detalle={muchas} modo="flujo" />);
    await u.click(screen.getByRole("tab", { name: "Mermas/Cambios/Promociones" }));
    const promos = screen.getByRole("table", { name: "Promociones de Don Gallo" });
    expect(within(promos).getAllByRole("row")[1]).toHaveTextContent("Horchata 500 ml1,200");
    // Como el viejo: Producto · Cantidad y su Total.
    expect(within(promos).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Producto", "Cantidad"]);
    expect(within(promos).getAllByRole("row").at(-1)).toHaveTextContent("Total1,200");
  });

  it("sin datos: los textos de vacío", async () => {
    const u = userEvent.setup();
    const vacio: DetalleVendedorDia = { ...DETALLE, notasCredito: [], promociones: [] };
    render(<DetalleVendedor detalle={vacio} modo="flujo" />);
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    expect(screen.getByText("No hay notas pendientes.")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Mermas/Cambios/Promociones" }));
    expect(screen.getByText("Sin promociones este día.")).toBeInTheDocument();
  });
});

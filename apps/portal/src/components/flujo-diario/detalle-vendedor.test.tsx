import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import { diaAnterior } from "@/lib/fechas";
import { hoyEnTijuana } from "@/lib/ventas";
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
  notasCredito: [
    { ventaNotaId: "v-rb10", folio: "TJ261109RB10", cliente: "Don Gallo", totalCentavos: 92000, pendienteCentavos: 92000, entregada: null, condicionVenta: null, comentarioVendedor: null },
  ],
  asignadasCobradas: [],
  asignadasPorEntregar: [],
  notasNoEntregadas: [],
  visitas: [
    { cliente: "Schlage Tecate", visitado: false, vendio: false, hora: null, motivo: null, atendio: null, comentario: null },
    { cliente: "Tyco Cge", visitado: true, vendio: true, hora: "2026-11-09T16:42:00.000Z", motivo: null, atendio: null, comentario: null },
    { cliente: "Abarrotes Mary", visitado: true, vendio: false, hora: "2026-11-09T17:15:00.000Z", motivo: "Tiene producto", atendio: "Mary", comentario: "Pasar el jueves" },
  ],
  promociones: [{ cliente: "Don Gallo", producto: "Horchata 500 ml", cantidad: 4 }],
  corte: null,
};

describe("DetalleVendedor", () => {
  it("Venta general: Por producto agrupado por presentación; el selector pasa a Por cliente", async () => {
    const u = userEvent.setup();
    render(<DetalleVendedor detalle={DETALLE} modo="flujo" />);
    expect(screen.getByRole("radio", { name: "Por producto" })).toHaveAttribute("aria-checked", "true");
    // El encabezado de cada presentación lleva solo su nombre (el total ya se ve en sus renglones).
    expect(screen.getByText("600 ml")).toBeInTheDocument();
    expect(screen.getByText("500 ml")).toBeInTheDocument();
    expect(screen.queryByText("600 ml · 390")).not.toBeInTheDocument();
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

  it("Ruta (las visitas, como el viejo) en hora de Tijuana; Notas de ventas y promociones por cliente", async () => {
    const u = userEvent.setup();
    render(<DetalleVendedor detalle={DETALLE} modo="flujo" />);
    expect(screen.queryByRole("tab", { name: "Visitas" })).not.toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Ruta" }));
    expect(screen.getByText("8:42")).toBeInTheDocument();
    // El cliente de la ruta que no se visitó: Vendió No y "Cliente no visitado" en la hora.
    // El conteo es de clientes (como el x / y del Dashboard), no de renglones.
    expect(screen.getByText("2 clientes visitados · 1 con venta · 1 no visitado")).toBeInTheDocument();
    const noVisitado = within(screen.getByRole("table", { name: "Ruta" })).getByText("Schlage Tecate").closest("tr")!;
    expect(noVisitado).toHaveTextContent("No");
    expect(noVisitado).toHaveTextContent("Cliente no visitado");
    expect(screen.getByText("Pasar el jueves")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Notas de ventas" }));
    expect(within(screen.getByRole("tabpanel")).getByText("TJ261109RB10")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Mermas/Cambios/Promociones" }));
    // Como el viejo: "Cliente: Don Gallo".
    expect(within(screen.getByRole("tabpanel")).getByText("Cliente: Don Gallo")).toBeInTheDocument();
  });

  describe("Notas de ventas (la revisión de la tarde)", () => {
    const HOY = hoyEnTijuana();
    const nueva = (folio: string, entregada: boolean | null, extra: Partial<fd.NotaRevision> = {}): fd.NotaRevision => ({
      ventaNotaId: `v-${folio}`, folio, cliente: `Cliente ${folio}`, totalCentavos: 10000, pendienteCentavos: 4000, entregada, condicionVenta: null, comentarioVendedor: null, ...extra,
    });
    const REVISION: DetalleVendedorDia = {
      ...DETALLE,
      fecha: HOY,
      asignadasCobradas: [nueva("TJ261101AP01", null, { cliente: "Pagó Ya", pendienteCentavos: 0 })],
      asignadasPorEntregar: [nueva("TJ261102AP02", null), nueva("TJ261102AP03", true)],
      notasCredito: [nueva("TJ261111RB10", null), nueva("TJ261111RB11", false, { cliente: "Mary" })],
      notasNoEntregadas: [],
    };
    const abrir = async (u: ReturnType<typeof userEvent.setup>) =>
      u.click(screen.getByRole("tab", { name: "Notas de ventas" }));

    it("en las asignadas por entregar se ve la condición y el comentario del vendedor; una nueva a crédito no", async () => {
      const u = userEvent.setup();
      render(
        <DetalleVendedor
          detalle={{
            ...REVISION,
            asignadasPorEntregar: [
              nueva("TJ261102AP02", null, {
                condicionVenta: "liquidar",
                comentarioVendedor: { texto: "no estaba el encargado", vendedor: "Juan" },
              }),
            ],
          }}
          modo="dashboard"
        />,
      );
      await abrir(u);
      const por = screen.getByRole("table", { name: "Notas Asignadas NO cobradas por Entregar" });
      expect(within(por).getByText("Juan: no estaba el encargado")).toBeInTheDocument();
      expect(within(por).getByText("Solo si liquida")).toBeInTheDocument();
      const nuevas = screen.getByRole("table", { name: "Notas Nuevas x Cobrar Entregadas" });
      expect(within(nuevas).queryByText(/Solo si/)).toBeNull();
      expect(within(nuevas).queryByText(/Juan:/)).toBeNull();
    });

    it("la condición 'abonar' se rotula 'Solo si abona' y 'ninguna' no lleva etiqueta", async () => {
      const u = userEvent.setup();
      render(
        <DetalleVendedor
          detalle={{
            ...REVISION,
            asignadasPorEntregar: [
              nueva("TJ261102AP02", null, { condicionVenta: "abonar" }),
              nueva("TJ261102AP03", null, { condicionVenta: "ninguna" }),
            ],
          }}
          modo="dashboard"
        />,
      );
      await abrir(u);
      const por = screen.getByRole("table", { name: "Notas Asignadas NO cobradas por Entregar" });
      expect(within(por).getByText("Solo si abona")).toBeInTheDocument();
      expect(within(por).queryByText(/Solo si liquida/)).toBeNull();
      expect(within(por).getAllByText(/Solo si/)).toHaveLength(1);
    });

    it("las tres listas con sus nombres; las casillas vienen palomeadas si no se han revisado", async () => {
      const u = userEvent.setup();
      render(<DetalleVendedor detalle={REVISION} modo="dashboard" />);
      await abrir(u);
      const cobradas = screen.getByRole("table", { name: "Notas Asignadas Cobradas" });
      expect(within(cobradas).getByText("Pagó Ya")).toBeInTheDocument();
      // Solo se ven: sin casilla.
      expect(within(cobradas).queryByRole("checkbox")).not.toBeInTheDocument();
      const asignadas = screen.getByRole("table", { name: "Notas Asignadas NO cobradas por Entregar" });
      expect(within(asignadas).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
        "Cliente",
        "Folio",
        "Monto",
        "Pendiente",
        "Entregada",
      ]);
      expect(within(asignadas).getByRole("checkbox", { name: "Entregada TJ261102AP02" })).toBeChecked();
      expect(within(asignadas).getByRole("checkbox", { name: "Entregada TJ261102AP03" })).toBeChecked();
      const nuevas = screen.getByRole("table", { name: "Notas Nuevas x Cobrar Entregadas" });
      expect(within(nuevas).getByRole("checkbox", { name: "Entregada TJ261111RB10" })).toBeChecked();
      // La guardada como NO entregada sale sin palomita.
      expect(within(nuevas).getByRole("checkbox", { name: "Entregada TJ261111RB11" })).not.toBeChecked();
    });

    it("Guardar revisión manda las dos listas completas con la fecha del detalle y avisa cuántas no llegaron", async () => {
      const u = userEvent.setup();
      const guardadas = vi.fn();
      guardarNotasEntregadas.mockResolvedValue(undefined);
      render(<DetalleVendedor detalle={REVISION} modo="dashboard" onNotasGuardadas={guardadas} />);
      await abrir(u);
      // Con notas sin revisar se puede guardar sin tocar nada (todo llegó)...
      const guardar = screen.getByRole("button", { name: "Guardar revisión" });
      expect(guardar).toBeEnabled();
      // ...pero no hay nada que cancelar.
      expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
      await u.click(screen.getByRole("checkbox", { name: "Entregada TJ261102AP02" }));
      await u.click(guardar);
      expect(guardarNotasEntregadas).toHaveBeenCalledWith({
        vendedor: "ricardo",
        fecha: HOY,
        notas: [
          { folio: "TJ261111RB10", entregada: true },
          { folio: "TJ261111RB11", entregada: false },
        ],
        asignadas: [
          { ventaNotaId: "v-TJ261102AP02", entregada: false },
          { ventaNotaId: "v-TJ261102AP03", entregada: true },
        ],
      });
      await waitFor(() => expect(guardadas).toHaveBeenCalledWith(2));
    });

    it("todo revisado y sin cambios: Guardar y Cancelar deshabilitados; Cancelar regresa a lo guardado", async () => {
      const u = userEvent.setup();
      const revisado: DetalleVendedorDia = {
        ...REVISION,
        asignadasPorEntregar: [nueva("TJ261102AP03", true)],
        notasCredito: [nueva("TJ261111RB11", false)],
      };
      const cambios = vi.fn();
      render(<DetalleVendedor detalle={revisado} modo="dashboard" onCambiosPendientes={cambios} />);
      await abrir(u);
      const guardar = screen.getByRole("button", { name: "Guardar revisión" });
      const cancelar = screen.getByRole("button", { name: "Cancelar" });
      expect(guardar).toBeDisabled();
      expect(cancelar).toBeDisabled();
      const ap03 = screen.getByRole("checkbox", { name: "Entregada TJ261102AP03" });
      const rb11 = screen.getByRole("checkbox", { name: "Entregada TJ261111RB11" });
      await u.click(ap03);
      await u.click(rb11);
      expect(guardar).toBeEnabled();
      expect(cancelar).toBeEnabled();
      expect(cambios).toHaveBeenLastCalledWith(true);
      await u.click(cancelar);
      expect(ap03).toBeChecked();
      expect(rb11).not.toBeChecked();
      expect(guardar).toBeDisabled();
      expect(cambios).toHaveBeenLastCalledWith(false);
      expect(guardarNotasEntregadas).not.toHaveBeenCalled();
    });

    it("abrir con notas sin revisar no cuenta como cambio pendiente (no pregunta al cerrar)", async () => {
      const u = userEvent.setup();
      const cambios = vi.fn();
      render(<DetalleVendedor detalle={REVISION} modo="dashboard" onCambiosPendientes={cambios} />);
      await abrir(u);
      expect(cambios).not.toHaveBeenCalledWith(true);
    });

    it("si Guardar falla, avisa el error y no avisa guardado", async () => {
      const u = userEvent.setup();
      const guardadas = vi.fn();
      guardarNotasEntregadas.mockRejectedValue(new ErrorApi("x", 400, "Ese día ya no se puede revisar."));
      render(<DetalleVendedor detalle={REVISION} modo="dashboard" onNotasGuardadas={guardadas} />);
      await abrir(u);
      await u.click(screen.getByRole("button", { name: "Guardar revisión" }));
      expect(await screen.findByText("Ese día ya no se puede revisar.")).toBeInTheDocument();
      expect(guardadas).not.toHaveBeenCalled();
    });

    it("tras guardar bien, se olvidan las marcas locales y se ve lo que diga el servidor", async () => {
      const u = userEvent.setup();
      guardarNotasEntregadas.mockResolvedValue(undefined);
      const una = (entregada: boolean | null): DetalleVendedorDia => ({
        ...REVISION,
        asignadasPorEntregar: [],
        notasCredito: [nueva("TJ261111RB10", entregada)],
      });
      const { rerender } = render(<DetalleVendedor detalle={una(null)} modo="dashboard" />);
      await abrir(u);
      await u.click(screen.getByRole("checkbox", { name: "Entregada TJ261111RB10" }));
      await u.click(screen.getByRole("button", { name: "Guardar revisión" }));
      await waitFor(() => expect(guardarNotasEntregadas).toHaveBeenCalledTimes(1));
      // Llega el detalle nuevo: otra persona la dejó como entregada después.
      rerender(<DetalleVendedor detalle={una(true)} modo="dashboard" />);
      expect(screen.getByRole("checkbox", { name: "Entregada TJ261111RB10" })).toBeChecked();
      expect(screen.getByRole("button", { name: "Guardar revisión" })).toBeDisabled();
    });

    it("Notas de Ventas NO Entregadas: lo guardado en no de las dos listas y las de días anteriores", async () => {
      const u = userEvent.setup();
      const detalle: DetalleVendedorDia = {
        ...REVISION,
        asignadasPorEntregar: [nueva("TJ261102AP02", false, { cliente: "Asignada No" }), nueva("TJ261102AP03", true)],
        notasCredito: [nueva("TJ261111RB10", null), nueva("TJ261111RB11", false, { cliente: "Nueva No" })],
        notasNoEntregadas: [
          { folio: "TJ261105RB03", cliente: "Tacos Beto", fecha: "2026-11-05", totalCentavos: 30000, pendienteCentavos: 12000 },
        ],
      };
      render(<DetalleVendedor detalle={detalle} modo="dashboard" />);
      await abrir(u);
      const tabla = screen.getByRole("table", { name: "Notas de Ventas NO Entregadas" });
      expect(within(tabla).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
        "Cliente",
        "Folio",
        "Fecha",
        "Monto",
        "Pendiente",
      ]);
      expect(within(tabla).getByText("Asignada No")).toBeInTheDocument();
      expect(within(tabla).getByText("Nueva No")).toBeInTheDocument();
      expect(within(tabla).getByText("Tacos Beto")).toBeInTheDocument();
      expect(within(tabla).getByText("$120.00")).toBeInTheDocument();
      // Lo que no se ha guardado (null) o se guardó en sí no sale.
      expect(within(tabla).queryByText("TJ261111RB10")).not.toBeInTheDocument();
      expect(within(tabla).queryByText("TJ261102AP03")).not.toBeInTheDocument();
    });

    it("una asignada guardada en no y pagada después: sale en NO Entregadas, cuenta y se puede volver a palomear", async () => {
      const u = userEvent.setup();
      const guardadas = vi.fn();
      guardarNotasEntregadas.mockResolvedValue(undefined);
      const detalle: DetalleVendedorDia = {
        ...REVISION,
        asignadasCobradas: [
          nueva("TJ261101AP01", null, { cliente: "Pagó Ya", pendienteCentavos: 0 }),
          nueva("TJ261101AP04", false, { cliente: "Pagó Sin Papel", pendienteCentavos: 0 }),
        ],
        asignadasPorEntregar: [nueva("TJ261102AP03", true)],
        notasCredito: [nueva("TJ261111RB11", true)],
      };
      render(<DetalleVendedor detalle={detalle} modo="dashboard" onNotasGuardadas={guardadas} />);
      await abrir(u);
      const cobradas = screen.getByRole("table", { name: "Notas Asignadas Cobradas" });
      // La que nunca se revisó solo se ve; la revisada lleva su casilla, sin palomita.
      expect(within(cobradas).queryByRole("checkbox", { name: "Entregada TJ261101AP01" })).not.toBeInTheDocument();
      const ap04 = within(cobradas).getByRole("checkbox", { name: "Entregada TJ261101AP04" });
      expect(ap04).not.toBeChecked();
      const no = screen.getByRole("table", { name: "Notas de Ventas NO Entregadas" });
      expect(within(no).getByText("Pagó Sin Papel")).toBeInTheDocument();
      // Todo está guardado: nada por guardar todavía.
      expect(screen.getByRole("button", { name: "Guardar revisión" })).toBeDisabled();
      // Al fin sí llegó: se vuelve a palomear y se guarda.
      await u.click(ap04);
      await u.click(screen.getByRole("button", { name: "Guardar revisión" }));
      expect(guardarNotasEntregadas).toHaveBeenCalledWith({
        vendedor: "ricardo",
        fecha: HOY,
        notas: [{ folio: "TJ261111RB11", entregada: true }],
        asignadas: [
          { ventaNotaId: "v-TJ261102AP03", entregada: true },
          { ventaNotaId: "v-TJ261101AP04", entregada: true },
        ],
      });
      await waitFor(() => expect(guardadas).toHaveBeenCalledWith(0));
    });

    it("el número que se avisa al guardar cuenta la asignada cobrada que sigue en no", async () => {
      const u = userEvent.setup();
      const guardadas = vi.fn();
      guardarNotasEntregadas.mockResolvedValue(undefined);
      const detalle: DetalleVendedorDia = {
        ...REVISION,
        asignadasCobradas: [nueva("TJ261101AP04", false, { pendienteCentavos: 0 })],
        asignadasPorEntregar: [],
        notasCredito: [nueva("TJ261111RB10", null)],
      };
      render(<DetalleVendedor detalle={detalle} modo="dashboard" onNotasGuardadas={guardadas} />);
      await abrir(u);
      await u.click(screen.getByRole("button", { name: "Guardar revisión" }));
      expect(guardarNotasEntregadas).toHaveBeenCalledWith(
        expect.objectContaining({ asignadas: [{ ventaNotaId: "v-TJ261101AP04", entregada: false }] }),
      );
      await waitFor(() => expect(guardadas).toHaveBeenCalledWith(1));
    });

    it("solo consulta: la asignada cobrada dice Sí / No, o — si nunca se revisó", async () => {
      const u = userEvent.setup();
      mockAuth([]);
      const detalle: DetalleVendedorDia = {
        ...REVISION,
        asignadasCobradas: [
          nueva("TJ261101AP01", null, { pendienteCentavos: 0 }),
          nueva("TJ261101AP04", false, { pendienteCentavos: 0 }),
          nueva("TJ261101AP05", true, { pendienteCentavos: 0 }),
        ],
      };
      render(<DetalleVendedor detalle={detalle} modo="dashboard" />);
      await abrir(u);
      const cobradas = screen.getByRole("table", { name: "Notas Asignadas Cobradas" });
      expect(within(cobradas).getByText("TJ261101AP01").closest("tr")).toHaveTextContent(/—$/);
      expect(within(cobradas).getByText("TJ261101AP04").closest("tr")).toHaveTextContent(/No$/);
      expect(within(cobradas).getByText("TJ261101AP05").closest("tr")).toHaveTextContent(/Sí$/);
    });

    it("sin notas NO entregadas, esa lista no sale", async () => {
      const u = userEvent.setup();
      const detalle: DetalleVendedorDia = { ...REVISION, notasCredito: [nueva("TJ261111RB10", true)] };
      render(<DetalleVendedor detalle={detalle} modo="dashboard" />);
      await abrir(u);
      expect(screen.queryByText("Notas de Ventas NO Entregadas")).not.toBeInTheDocument();
    });

    it("sin nota_papel.revisar: solo consulta (Sí / No / Sin revisar), sin casillas ni botones", async () => {
      const u = userEvent.setup();
      mockAuth([]);
      render(<DetalleVendedor detalle={REVISION} modo="dashboard" />);
      await abrir(u);
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Guardar revisión" })).not.toBeInTheDocument();
      const nuevas = screen.getByRole("table", { name: "Notas Nuevas x Cobrar Entregadas" });
      expect(within(nuevas).getByText("TJ261111RB10").closest("tr")).toHaveTextContent("Sin revisar");
      expect(within(nuevas).getByText("TJ261111RB11").closest("tr")).toHaveTextContent(/No$/);
      const asignadas = screen.getByRole("table", { name: "Notas Asignadas NO cobradas por Entregar" });
      expect(within(asignadas).getByText("TJ261102AP03").closest("tr")).toHaveTextContent(/Sí$/);
    });

    it("Flujo diario: se puede guardar si el día es ayer", async () => {
      const u = userEvent.setup();
      guardarNotasEntregadas.mockResolvedValue(undefined);
      const ayer = diaAnterior(HOY);
      render(<DetalleVendedor detalle={{ ...REVISION, fecha: ayer }} modo="flujo" />);
      await abrir(u);
      await u.click(screen.getByRole("button", { name: "Guardar revisión" }));
      expect(guardarNotasEntregadas).toHaveBeenCalledWith(expect.objectContaining({ fecha: ayer }));
    });

    it("Flujo diario: un día anterior a ayer es solo consulta", async () => {
      const u = userEvent.setup();
      render(<DetalleVendedor detalle={{ ...REVISION, fecha: diaAnterior(diaAnterior(HOY)) }} modo="flujo" />);
      await abrir(u);
      expect(screen.getByRole("table", { name: "Notas Asignadas NO cobradas por Entregar" })).toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Guardar revisión" })).not.toBeInTheDocument();
    });
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { diaAnterior } from "@/lib/fechas";
import * as lib from "@/lib/inventario-pt";
import type { AjustesPt, InventarioPt, RenglonPt } from "@/lib/inventario-pt";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaInventarioPt } from "./pantalla-inventario-pt";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/inventario-pt", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/inventario-pt")>();
  return {
    ...real,
    leerInventarioPt: vi.fn(),
    leerHistorialPt: vi.fn(),
    leerDescuentosPt: vi.fn(),
    leerAjustesPt: vi.fn(),
    guardarAjustesPt: vi.fn(),
    borrarAjustePt: vi.fn(),
  };
});

const HOY = hoyEnTijuana();
const AYER = diaAnterior(HOY);
const VER = "inventario_pt.ver";
const AJUSTAR = "inventario_pt.ajustar";

function mockAuth(permisos: string[], codigo: string | null = "TJ") {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1",
      login: "ana",
      nombre: "Ana",
      perfil: "Administrador General",
      sucursal: codigo ? { id: "s", codigo, nombre: codigo } : null,
      permisos,
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (c: string) => permisos.includes(c),
  });
}

const renglon = (producto: string, volumen: string, m: Partial<RenglonPt> = {}): RenglonPt => ({
  presentacionId: `p-${producto}-${volumen}`,
  productoId: `prod-${producto}`,
  producto,
  volumen,
  inicial: 0,
  ventas: 0,
  merma: 0,
  consumo: 0,
  promo: 0,
  descuentos: 0,
  cambios: 0,
  entradas: 0,
  envios: 0,
  final: 0,
  mermaAcumulada: 0,
  retiroMerma: 0,
  ajustado: false,
  ...m,
});

const DIA: InventarioPt = {
  fecha: AYER,
  hoyEnTijuana: HOY,
  renglones: [
    renglon("Horchata", "500 ml", { inicial: 1378, ventas: 691, merma: 2, consumo: 3, descuentos: 2, cambios: 2, entradas: 1258, final: 1940, mermaAcumulada: 62, ajustado: true }),
    renglon("Jamaica", "500 ml", { inicial: 940, ventas: 412, merma: 5, promo: 4, cambios: -2, entradas: 600, envios: 100, final: 1017, mermaAcumulada: 30, retiroMerma: 20 }),
    renglon("Agua", "1 L", { inicial: null, ventas: 210, final: null, mermaAcumulada: null }),
  ],
};

const PRODUCTO: InventarioPt = {
  fecha: AYER,
  hoyEnTijuana: HOY,
  renglones: [
    renglon("Agua", "", { presentacionId: null, ventas: 210, inicial: null, final: null, mermaAcumulada: null }),
    renglon("Horchata", "", { presentacionId: null, ventas: 900, inicial: 2000, final: 1500, ajustado: true }),
  ],
};

const AJUSTES: AjustesPt = {
  fecha: AYER,
  hoyEnTijuana: HOY,
  renglones: [
    { presentacionId: "h5", productoId: "h", producto: "Horchata", volumen: "500 ml", inventarioInicial: 1378, mermaAcumuladaInicial: 60, ajustado: true },
    { presentacionId: "j5", productoId: "j", producto: "Jamaica", volumen: "500 ml", inventarioInicial: 940, mermaAcumuladaInicial: 10, ajustado: false },
    { presentacionId: "a1", productoId: "a", producto: "Agua", volumen: "1 L", inventarioInicial: null, mermaAcumuladaInicial: null, ajustado: false },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth([VER, AJUSTAR]);
  vi.mocked(lib.leerInventarioPt).mockImplementation(async (_f, _s, vista) => (vista === "producto" ? PRODUCTO : DIA));
  vi.mocked(lib.leerHistorialPt).mockResolvedValue({ dias: [] });
  vi.mocked(lib.leerDescuentosPt).mockResolvedValue({ detalle: [] });
  vi.mocked(lib.leerAjustesPt).mockResolvedValue(AJUSTES);
  vi.mocked(lib.guardarAjustesPt).mockResolvedValue(undefined);
  vi.mocked(lib.borrarAjustePt).mockResolvedValue(undefined);
});

const tabla = () => screen.findByRole("table", { name: "Inventario de PT" });
const fila = (t: HTMLElement, texto: string) => within(t).getByText(texto).closest("tr") as HTMLElement;
const celdas = (tr: HTMLElement) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent);

describe("PantallaInventarioPt: el día", () => {
  it("abre en ayer, por presentación, con la tabla por tamaño y su total", async () => {
    render(<PantallaInventarioPt sucursal={null} />);
    await waitFor(() => expect(lib.leerInventarioPt).toHaveBeenCalledWith(AYER, "TJ", "presentacion"));
    const t = await tabla();
    expect(within(t).getByRole("rowheader", { name: "500 ml" })).toBeInTheDocument();
    expect(within(t).getByRole("rowheader", { name: "1 L" })).toBeInTheDocument();
    expect(celdas(fila(t, "Jamaica"))).toEqual(["Jamaica", "940", "412", "5", "0", "4", "0", "−2", "600", "100", "1017", "30", "20"]);
    expect(celdas(fila(t, "Total 500 ml"))).toEqual(["Total 500 ml", "2318", "1103", "7", "3", "4", "2", "0", "1858", "100", "2957", "92", "20"]);
    expect(within(fila(t, "Horchata")).getByText("+2")).toBeInTheDocument();
    // El día escrito, como Procesos.
    expect(screen.getByText(/^Ayer, /)).toBeInTheDocument();
  });

  it("el Inicial ajustado lleva la marca", async () => {
    render(<PantallaInventarioPt sucursal={null} />);
    const t = await tabla();
    expect(within(fila(t, "Horchata")).getByText("Ajustado")).toBeInTheDocument();
    expect(within(fila(t, "Jamaica")).queryByText("Ajustado")).toBeNull();
  });

  it("sin inventario inicial: celdas vacías (no 0) y un aviso", async () => {
    render(<PantallaInventarioPt sucursal={null} />);
    const t = await tabla();
    expect(celdas(fila(t, "Agua"))).toEqual(["Agua", "", "210", "0", "0", "0", "0", "0", "0", "0", "", "", "0"]);
    expect(celdas(fila(t, "Total 1 L"))[1]).toBe("");
    expect(screen.getByText(/1 presentación sin inventario inicial/)).toBeInTheDocument();
  });

  it("Por producto: un renglón por producto, sin grupos de tamaño", async () => {
    render(<PantallaInventarioPt sucursal={null} />);
    await tabla();
    await userEvent.click(screen.getByRole("radio", { name: "Por producto" }));
    await waitFor(() => expect(lib.leerInventarioPt).toHaveBeenLastCalledWith(AYER, "TJ", "producto"));
    const t = await screen.findByRole("table", { name: "Inventario de PT" });
    await within(t).findByText("Horchata");
    expect(within(t).queryByRole("rowheader")).toBeNull();
    expect(celdas(fila(t, "Horchata"))[1]).toBe("2000");
    // Por producto no lleva la marca "Ajustado" (decisión del controlador): mezcla presentaciones.
    expect(within(t).queryByText("Ajustado")).toBeNull();
    expect(screen.getByText(/1 producto sin inventario inicial/)).toBeInTheDocument();
  });

  it("al cambiar de vista, mientras llega la consulta no queda la pantalla vacía", async () => {
    render(<PantallaInventarioPt sucursal={null} />);
    await tabla();
    vi.mocked(lib.leerInventarioPt).mockReturnValue(new Promise(() => {}));
    await userEvent.click(screen.getByRole("radio", { name: "Por producto" }));
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });

  it("al cambiar de día, la tabla anterior queda atenuada mientras llega la nueva", async () => {
    render(<PantallaInventarioPt sucursal={null} />);
    await tabla();
    vi.mocked(lib.leerInventarioPt).mockReturnValue(new Promise(() => {}));
    await userEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.getByRole("table", { name: "Inventario de PT" })).toBeInTheDocument();
  });

  it("Hoy vuelve a consultar", async () => {
    render(<PantallaInventarioPt sucursal={null} />);
    await tabla();
    await userEvent.click(screen.getByRole("button", { name: "Hoy" }));
    await waitFor(() => expect(lib.leerInventarioPt).toHaveBeenLastCalledWith(HOY, "TJ", "presentacion"));
  });

  it("General: la sucursal del menú; sin elegir, Todas", async () => {
    mockAuth([VER], null);
    const { unmount } = render(<PantallaInventarioPt sucursal="mx" />);
    await waitFor(() => expect(lib.leerInventarioPt).toHaveBeenCalledWith(AYER, "MX", "presentacion"));
    unmount();
    render(<PantallaInventarioPt sucursal={null} />);
    await waitFor(() => expect(lib.leerInventarioPt).toHaveBeenLastCalledWith(AYER, "todas", "presentacion"));
  });

  it("sin permiso", () => {
    mockAuth([]);
    render(<PantallaInventarioPt sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(lib.leerInventarioPt).not.toHaveBeenCalled();
  });

  it("sin el permiso de ajustar no sale el botón; con Todas sale deshabilitado", async () => {
    mockAuth([VER]);
    const { unmount } = render(<PantallaInventarioPt sucursal={null} />);
    await tabla();
    expect(screen.queryByRole("button", { name: "Ajustar inventario" })).toBeNull();
    unmount();
    mockAuth([VER, AJUSTAR], null);
    render(<PantallaInventarioPt sucursal="todas" />);
    await tabla();
    expect(screen.getByRole("button", { name: "Ajustar inventario" })).toBeDisabled();
  });

  it("un fallo se muestra como error", async () => {
    vi.mocked(lib.leerInventarioPt).mockRejectedValue(new Error("x"));
    render(<PantallaInventarioPt sucursal={null} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("PantallaInventarioPt: detalles al picar", () => {
  it("picar un producto abre sus días (7 que terminan en el elegido) con su total", async () => {
    const d = (fecha: string, m: Partial<RenglonPt>) => ({ ...renglon("Horchata", "500 ml", m), fecha });
    vi.mocked(lib.leerHistorialPt).mockResolvedValue({
      dias: [
        d(diaAnterior(AYER), { inicial: 1378, ventas: 0, final: 1378, mermaAcumulada: 60 }),
        d(AYER, { inicial: 1378, ventas: 691, merma: 2, entradas: 1258, final: 1940, mermaAcumulada: 62, cambios: -1 }),
      ],
    });
    render(<PantallaInventarioPt sucursal={null} />);
    const t = await tabla();
    await userEvent.click(within(t).getByRole("button", { name: "Horchata" }));
    let desde = AYER;
    for (let i = 0; i < 6; i++) desde = diaAnterior(desde);
    await waitFor(() =>
      expect(lib.leerHistorialPt).toHaveBeenCalledWith({ presentacion: "p-Horchata-500 ml" }, desde, AYER, "TJ"),
    );
    const ventana = await screen.findByRole("dialog");
    expect(within(ventana).getByText(/^Horchata 500 ml · del /)).toBeInTheDocument();
    const h = await within(ventana).findByRole("table", { name: "Días de Horchata 500 ml" });
    const total = within(h).getByText("Total").closest("tr") as HTMLElement;
    expect(celdas(total)).toEqual(["Total", "", "691", "2", "0", "0", "0", "−1", "1258", "0", "", "", "0"]);
  });

  it("en la vista por producto el historial se pide por producto y no lleva la marca Ajustado", async () => {
    vi.mocked(lib.leerHistorialPt).mockResolvedValue({
      dias: [{ ...renglon("Horchata", "", { presentacionId: null, inicial: 5, ajustado: true }), fecha: AYER }],
    });
    render(<PantallaInventarioPt sucursal={null} />);
    await tabla();
    await userEvent.click(screen.getByRole("radio", { name: "Por producto" }));
    const t = await screen.findByRole("table", { name: "Inventario de PT" });
    await userEvent.click(await within(t).findByRole("button", { name: "Horchata" }));
    await waitFor(() =>
      expect(lib.leerHistorialPt).toHaveBeenCalledWith({ producto: "prod-Horchata" }, expect.any(String), AYER, "TJ"),
    );
    const h = await within(await screen.findByRole("dialog")).findByRole("table", { name: "Días de Horchata" });
    expect(within(h).getByText("5")).toBeInTheDocument();
    expect(within(h).queryByText("Ajustado")).toBeNull();
  });

  it("el título del historial cambia junto con la tabla", async () => {
    render(<PantallaInventarioPt sucursal={null} />);
    const t = await tabla();
    await userEvent.click(within(t).getByRole("button", { name: "Horchata" }));
    const ventana = await screen.findByRole("dialog");
    await waitFor(() => expect(lib.leerHistorialPt).toHaveBeenCalledTimes(1));
    const antes = within(ventana).getByText(/^Horchata 500 ml · /).textContent;
    let soltar: (v: { dias: [] }) => void = () => {};
    vi.mocked(lib.leerHistorialPt).mockReturnValue(new Promise((r) => (soltar = r)));
    const hasta = within(ventana).getByLabelText("Hasta");
    await userEvent.clear(hasta);
    await userEvent.type(hasta, diaAnterior(AYER));
    await waitFor(() => expect(lib.leerHistorialPt).toHaveBeenCalledTimes(2));
    expect(within(ventana).getByText(/^Horchata 500 ml · /).textContent).toBe(antes);
    soltar({ dias: [] });
    await waitFor(() => expect(within(ventana).getByText(/^Horchata 500 ml · /).textContent).not.toBe(antes));
  });

  it("un rango de más de 62 días no se pide", async () => {
    render(<PantallaInventarioPt sucursal={null} />);
    const t = await tabla();
    await userEvent.click(within(t).getByRole("button", { name: "Horchata" }));
    const ventana = await screen.findByRole("dialog");
    await waitFor(() => expect(lib.leerHistorialPt).toHaveBeenCalledTimes(1));
    const desde = within(ventana).getByLabelText("Desde");
    await userEvent.clear(desde);
    await userEvent.type(desde, "2026-01-01");
    expect(await within(ventana).findByText(/62 días/)).toBeInTheDocument();
    expect(lib.leerHistorialPt).toHaveBeenCalledTimes(1);
  });

  it("picar los Descuentos muestra a quién", async () => {
    vi.mocked(lib.leerDescuentosPt).mockResolvedValue({
      detalle: [
        { quien: "Ricardo", origen: "corte", piezas: 1 },
        { quien: "Pepe (producción)", origen: "nomina", piezas: 1 },
      ],
    });
    render(<PantallaInventarioPt sucursal={null} />);
    const t = await tabla();
    // Un 0 no se pica.
    expect(within(fila(t, "Jamaica")).queryByRole("button", { name: /Descuentos/ })).toBeNull();
    await userEvent.click(within(fila(t, "Horchata")).getByRole("button", { name: "Ver a quién: 2 piezas de descuento" }));
    await waitFor(() => expect(lib.leerDescuentosPt).toHaveBeenCalledWith({ presentacion: "p-Horchata-500 ml" }, AYER, "TJ"));
    const ventana = await screen.findByRole("dialog");
    expect(within(ventana).getByText(/^Descuentos · Horchata 500 ml · /)).toBeInTheDocument();
    const r = (await within(ventana).findByText("Ricardo")).closest("tr") as HTMLElement;
    expect(celdas(r)).toEqual(["Ricardo", "Faltante del corte", "1"]);
    expect(within(ventana).getByText("Nómina")).toBeInTheDocument();
  });
});

describe("PantallaInventarioPt: ajustar inventario", () => {
  async function abrirAjustes() {
    render(<PantallaInventarioPt sucursal={null} />);
    await tabla();
    await userEvent.click(screen.getByRole("button", { name: "Ajustar inventario" }));
    await waitFor(() => expect(lib.leerAjustesPt).toHaveBeenCalledWith(AYER, "TJ"));
    return screen.findByRole("table", { name: "Ajuste por presentación" });
  }

  it("precarga lo calculado, por tamaño, y marca lo ya ajustado", async () => {
    const t = await abrirAjustes();
    expect(screen.getByRole("heading", { name: "Ajustar inventario" })).toBeInTheDocument();
    expect(within(t).getByRole("rowheader", { name: "500 ml" })).toBeInTheDocument();
    expect(within(t).getByLabelText("Inventario inicial de Horchata 500 ml")).toHaveValue("1378");
    expect(within(t).getByLabelText("Merma acumulada de Horchata 500 ml")).toHaveValue("60");
    expect(within(t).getByLabelText("Inventario inicial de Agua 1 L")).toHaveValue("");
    expect(within(fila(t, "Horchata")).getByText("Ajustado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar ajuste" })).toBeDisabled();
  });

  it("TAB baja por la columna del inventario inicial y luego pasa a la merma", async () => {
    const t = await abrirAjustes();
    const ini = (n: string) => within(t).getByLabelText(`Inventario inicial de ${n}`);
    const mer = (n: string) => within(t).getByLabelText(`Merma acumulada de ${n}`);
    ini("Horchata 500 ml").focus();
    await userEvent.tab();
    expect(ini("Jamaica 500 ml")).toHaveFocus();
    await userEvent.tab();
    expect(ini("Agua 1 L")).toHaveFocus();
    await userEvent.tab();
    expect(mer("Horchata 500 ml")).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(ini("Agua 1 L")).toHaveFocus();
  });

  it("guarda solo los renglones cambiados y vuelve al día ajustado", async () => {
    const t = await abrirAjustes();
    const j = within(t).getByLabelText("Inventario inicial de Jamaica 500 ml");
    await userEvent.clear(j);
    await userEvent.type(j, "950");
    await userEvent.type(screen.getByLabelText(/Comentario/), " Conteo físico ");
    await userEvent.click(screen.getByRole("button", { name: "Guardar ajuste" }));
    await waitFor(() =>
      expect(lib.guardarAjustesPt).toHaveBeenCalledWith({
        fecha: AYER,
        sucursal: "TJ",
        comentario: "Conteo físico",
        renglones: [{ presentacionId: "j5", inventarioInicial: 950, mermaAcumuladaInicial: 10 }],
      }),
    );
    await tabla();
    expect(lib.leerInventarioPt).toHaveBeenLastCalledWith(AYER, "TJ", "presentacion");
  });

  it("un renglón cambiado sin los dos números no deja guardar", async () => {
    const t = await abrirAjustes();
    await userEvent.type(within(t).getByLabelText("Inventario inicial de Agua 1 L"), "7");
    expect(screen.getByRole("button", { name: "Guardar ajuste" })).toBeDisabled();
    expect(screen.getByText("Captura los dos números en 1 renglón para poder guardar.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.type(within(t).getByLabelText("Merma acumulada de Agua 1 L"), "0");
    expect(screen.getByRole("button", { name: "Guardar ajuste" })).toBeEnabled();
    await userEvent.type(within(t).getByLabelText("Merma acumulada de Agua 1 L"), "-");
    expect(screen.getByRole("alert")).toHaveTextContent("Los números son enteros de 0 en adelante.");
    expect(screen.getByRole("button", { name: "Guardar ajuste" })).toBeDisabled();
  });

  it("quitar el ajuste de un renglón ajustado pide confirmar y lo da de baja", async () => {
    const t = await abrirAjustes();
    expect(within(fila(t, "Jamaica")).queryByRole("button", { name: /Quitar ajuste/ })).toBeNull();
    await userEvent.click(within(fila(t, "Horchata")).getByRole("button", { name: "Quitar ajuste de Horchata 500 ml" }));
    const confirmar = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirmar).getByRole("button", { name: "Quitar ajuste" }));
    await waitFor(() => expect(lib.borrarAjustePt).toHaveBeenCalledWith(AYER, "TJ", "h5"));
    await waitFor(() => expect(lib.leerAjustesPt).toHaveBeenCalledTimes(2));
  });

  it("volver con solo un comentario escrito también pregunta", async () => {
    await abrirAjustes();
    await userEvent.type(screen.getByLabelText(/Comentario/), "Conteo");
    await userEvent.click(screen.getByRole("button", { name: /Volver a Inventario de PT/ }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("volver con cambios sin guardar pregunta antes", async () => {
    const t = await abrirAjustes();
    await userEvent.type(within(t).getByLabelText("Merma acumulada de Jamaica 500 ml"), "5");
    await userEvent.click(screen.getByRole("button", { name: /Volver a Inventario de PT/ }));
    const confirmar = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirmar).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("heading", { name: "Ajustar inventario" })).toBeInTheDocument();
  });
});

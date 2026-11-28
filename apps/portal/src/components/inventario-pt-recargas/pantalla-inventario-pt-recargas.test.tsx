import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { diaEscrito } from "@/lib/formato";
import * as lib from "@/lib/inventario-pt-recargas";
import type { InventarioPtRecargas, RenglonPtRecargas } from "@/lib/inventario-pt-recargas";
import { PantallaInventarioPtRecargas } from "./pantalla-inventario-pt-recargas";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/inventario-pt-recargas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/inventario-pt-recargas")>();
  return { ...real, leerInventarioPtRecargas: vi.fn(), leerDetallePtRecargas: vi.fn() };
});

// "Hoy" lo dice el servidor: una fecha que no es la del navegador lo prueba.
const HOY = "2026-11-25";
const VER = "inventario_pt_recargas.ver";
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

const renglon = (producto: string, volumen: string, m: Partial<RenglonPtRecargas> = {}): RenglonPtRecargas => ({
  presentacionId: `p-${producto}-${volumen}`,
  productoId: `prod-${producto}`,
  producto,
  volumen,
  inicial: 0,
  actual: 0,
  recargas: 0,
  envios: 0,
  entradas: 0,
  ...m,
});

const DIA: InventarioPtRecargas = {
  fecha: HOY,
  hoyEnTijuana: HOY,
  consultadoEn: "10:32",
  renglones: [
    renglon("Horchata", "500 ml", { inicial: 1940, recargas: 600, envios: 100, entradas: 300, actual: 1540 }),
    renglon("Jamaica", "500 ml", { inicial: 1017, recargas: 400, entradas: 50, actual: 667 }),
    renglon("Agua", "1 L", { inicial: null, recargas: 20, actual: null }),
  ],
};

const PRODUCTO: InventarioPtRecargas = {
  ...DIA,
  renglones: [
    renglon("Agua", "", { presentacionId: null, inicial: null, recargas: 20, actual: null }),
    renglon("Horchata", "", { presentacionId: null, inicial: 3000, recargas: 900, actual: 2100 }),
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth([VER, AJUSTAR]);
  vi.mocked(lib.leerInventarioPtRecargas).mockImplementation(async (_s, vista) => (vista === "producto" ? PRODUCTO : DIA));
  vi.mocked(lib.leerDetallePtRecargas).mockResolvedValue({ detalle: [] });
});

const tabla = () => screen.findByRole("table", { name: "Inventario de PT con Recargas" });
const fila = (t: HTMLElement, texto: string) => within(t).getByText(texto).closest("tr") as HTMLElement;
const celdas = (tr: HTMLElement) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent);

describe("PantallaInventarioPtRecargas: hoy", () => {
  it("por presentación, agrupada por tamaño con su total, el día escrito y la hora de la consulta", async () => {
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    await waitFor(() => expect(lib.leerInventarioPtRecargas).toHaveBeenCalledWith("TJ", "presentacion"));
    const t = await tabla();
    const encabezados = within(t).getAllByRole("columnheader").map((th) => th.textContent);
    expect(encabezados).toEqual([
      "Producto",
      "Inicial",
      "Recargas",
      "Envíos",
      "Entradas / Compras",
      "Actual",
    ]);
    expect(within(t).getByRole("rowheader", { name: "500 ml" })).toBeInTheDocument();
    expect(within(t).getByRole("rowheader", { name: "1 L" })).toBeInTheDocument();
    expect(celdas(fila(t, "Jamaica"))).toEqual(["Jamaica", "1017", "400", "0", "50", "667"]);
    expect(celdas(fila(t, "Total 500 ml"))).toEqual(["Total 500 ml", "2957", "1000", "100", "350", "2207"]);
    expect(screen.getByText(`${diaEscrito(HOY, HOY)} · a las 10:32`)).toBeInTheDocument();
  });

  it("sin marca «Ajustado» (aquí no se ajusta)", async () => {
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    const t = await tabla();
    expect(within(t).queryByText("Ajustado")).toBeNull();
    expect(celdas(fila(t, "Horchata"))[1]).toBe("1940");
  });

  it("sin inventario inicial: Inicial y Actual vacíos (no 0), total vacío y un aviso", async () => {
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    const t = await tabla();
    expect(celdas(fila(t, "Agua"))).toEqual(["Agua", "", "20", "0", "0", ""]);
    const total = celdas(fila(t, "Total 1 L"));
    expect(total[1]).toBe("");
    expect(total[5]).toBe("");
    expect(total[2]).toBe("20");
    const aviso = screen.getByText(/1 presentación sin inventario inicial/);
    expect(aviso).toHaveTextContent(/Inicial y Actual quedan vacíos/);
    expect(aviso).toHaveTextContent(/se capture un ajuste en Inventario de PT con Ventas/);
  });

  it("Por producto: un renglón por producto, sin grupos", async () => {
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    await tabla();
    await userEvent.click(screen.getByRole("radio", { name: "Por producto" }));
    await waitFor(() => expect(lib.leerInventarioPtRecargas).toHaveBeenLastCalledWith("TJ", "producto"));
    const t = await tabla();
    await within(t).findByText("Horchata");
    expect(within(t).queryByRole("rowheader")).toBeNull();
    expect(celdas(fila(t, "Horchata"))).toEqual(["Horchata", "3000", "900", "0", "0", "2100"]);
    expect(within(t).queryByText("Ajustado")).toBeNull();
    expect(screen.getByText(/1 producto sin inventario inicial/)).toBeInTheDocument();
  });

  it("Actualizar vuelve a pedir los datos", async () => {
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    await tabla();
    expect(lib.leerInventarioPtRecargas).toHaveBeenCalledTimes(1);
    vi.mocked(lib.leerInventarioPtRecargas).mockResolvedValue({ ...DIA, consultadoEn: "10:45" });
    await userEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(lib.leerInventarioPtRecargas).toHaveBeenCalledTimes(2));
    expect(lib.leerInventarioPtRecargas).toHaveBeenLastCalledWith("TJ", "presentacion");
    expect(await screen.findByText(/· a las 10:45/)).toBeInTheDocument();
  });

  it("General: la sucursal del menú; sin elegir, Todas", async () => {
    mockAuth([VER], null);
    const { unmount } = render(<PantallaInventarioPtRecargas sucursal="mx" />);
    await waitFor(() => expect(lib.leerInventarioPtRecargas).toHaveBeenCalledWith("MX", "presentacion"));
    unmount();
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    await waitFor(() => expect(lib.leerInventarioPtRecargas).toHaveBeenLastCalledWith("todas", "presentacion"));
  });

  it("sin inventario_pt_recargas.ver: sin permiso (aunque tenga el de PT con Ventas)", () => {
    mockAuth(["inventario_pt.ver", AJUSTAR]);
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(lib.leerInventarioPtRecargas).not.toHaveBeenCalled();
  });

  it("no hay botón de ajustar, ni con el permiso (se ajusta en PT con Ventas)", async () => {
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    await tabla();
    expect(screen.queryByRole("button", { name: "Ajustar inventario" })).toBeNull();
  });

  it("con Todas el aviso pide el ajuste de cada sucursal en PT con Ventas", async () => {
    mockAuth([VER, AJUSTAR], null);
    render(<PantallaInventarioPtRecargas sucursal="todas" />);
    await tabla();
    expect(screen.getByText(/1 presentación sin inventario inicial/)).toHaveTextContent(
      /cada sucursal capture su ajuste en Inventario de PT con Ventas/,
    );
  });

  it("un fallo se muestra como error", async () => {
    vi.mocked(lib.leerInventarioPtRecargas).mockRejectedValue(new Error("x"));
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("PantallaInventarioPtRecargas: a quién", () => {
  it("picar las Recargas muestra vendedor, carga y piezas con su total", async () => {
    vi.mocked(lib.leerDetallePtRecargas).mockResolvedValue({
      detalle: [
        { quien: "Ricardo", carga: 1, piezas: 400 },
        { quien: "Ricardo", carga: 2, piezas: 50 },
        { quien: "Pepe", carga: 1, piezas: 150 },
      ],
    });
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    const t = await tabla();
    // Los totales no se pican.
    expect(within(fila(t, "Total 500 ml")).queryByRole("button")).toBeNull();
    await userEvent.click(within(fila(t, "Horchata")).getByRole("button", { name: "Ver a quién: 600 piezas de recarga" }));
    await waitFor(() => expect(lib.leerDetallePtRecargas).toHaveBeenCalledWith({ presentacion: "p-Horchata-500 ml" }, "TJ"));
    const ventana = await screen.findByRole("dialog");
    expect(within(ventana).getByText(/^Recargas · Horchata 500 ml · /)).toBeInTheDocument();
    const d = await within(ventana).findByRole("table", { name: "A quién" });
    expect(within(d).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Vendedor", "Carga", "Piezas"]);
    expect(celdas(within(d).getByText("Pepe").closest("tr") as HTMLElement)).toEqual(["Pepe", "1", "150"]);
    expect(celdas(within(d).getByText("Total").closest("tr") as HTMLElement)).toEqual(["Total", "", "600"]);
  });

  it("en la vista por producto el detalle se pide por producto", async () => {
    render(<PantallaInventarioPtRecargas sucursal={null} />);
    await tabla();
    await userEvent.click(screen.getByRole("radio", { name: "Por producto" }));
    const t = await tabla();
    await userEvent.click(await within(fila(t, "Horchata")).findByRole("button", { name: "Ver a quién: 900 piezas de recarga" }));
    await waitFor(() => expect(lib.leerDetallePtRecargas).toHaveBeenCalledWith({ producto: "prod-Horchata" }, "TJ"));
  });
});

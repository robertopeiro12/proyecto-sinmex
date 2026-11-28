import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as lib from "@/lib/informacion-produccion";
import type { InformacionProduccion, RenglonInformacion } from "@/lib/informacion-produccion";
import { primerDiaDelMes } from "@/lib/fechas";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaInformacionProduccion } from "./pantalla-informacion-produccion";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/informacion-produccion", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/informacion-produccion")>();
  return { ...real, leerInformacionProduccion: vi.fn(), leerDetalleInformacion: vi.fn() };
});

const VER = "informacion_produccion.ver";
const HOY = hoyEnTijuana();
const INICIO = primerDiaDelMes(HOY);

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

const renglon = (producto: string, volumen: string, produccion: number, compras: number): RenglonInformacion => ({
  presentacionId: `p-${producto}-${volumen}`,
  productoId: `prod-${producto}`,
  producto,
  volumen,
  produccion,
  compras,
  total: produccion + compras,
});

const DATOS: InformacionProduccion = {
  desde: INICIO,
  hasta: HOY,
  hoyEnTijuana: HOY,
  renglones: [renglon("Horchata", "500 ml", 100, 20), renglon("Jamaica", "500 ml", 50, 0), renglon("Agua", "1 L", 0, 7)],
};
const PRODUCTO: InformacionProduccion = {
  ...DATOS,
  renglones: [
    { ...renglon("Horchata", "", 150, 20), presentacionId: null },
    { ...renglon("Jamaica", "", 50, 0), presentacionId: null },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth([VER]);
  vi.mocked(lib.leerInformacionProduccion).mockImplementation(async (_d, _h, _s, vista) =>
    vista === "producto" ? PRODUCTO : DATOS,
  );
  vi.mocked(lib.leerDetalleInformacion).mockResolvedValue({ detalle: [] });
});

const tabla = () => screen.findByRole("table", { name: "Información de Producción" });
const fila = (t: HTMLElement, texto: string) =>
  within(t.querySelector("tbody") as HTMLElement).getByText(texto).closest("tr") as HTMLElement;
const celdas = (tr: HTMLElement) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent);

describe("PantallaInformacionProduccion", () => {
  it("sin permiso", () => {
    mockAuth([]);
    render(<PantallaInformacionProduccion sucursal={null} />);
    expect(lib.leerInformacionProduccion).not.toHaveBeenCalled();
    expect(screen.getByText(/permiso/i)).toBeInTheDocument();
  });

  it("consulta al montar con este mes y la sucursal del usuario; tabla agrupada con totales", async () => {
    render(<PantallaInformacionProduccion sucursal={null} />);
    await waitFor(() =>
      expect(lib.leerInformacionProduccion).toHaveBeenCalledWith(INICIO, HOY, "TJ", "presentacion"),
    );
    const t = await tabla();
    expect(within(t).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Producto",
      "Producción",
      "Compras",
      "Total",
    ]);
    expect(celdas(fila(t, "Horchata"))).toEqual(["Horchata", "100", "20", "120"]);
    expect(celdas(fila(t, "Total 500 ml"))).toEqual(["Total 500 ml", "150", "20", "170"]);
    expect(celdas(fila(t, "Total"))).toEqual(["Total", "150", "27", "177"]);
  });

  it("Por producto: un renglón por producto y Total", async () => {
    render(<PantallaInformacionProduccion sucursal={null} />);
    await tabla();
    await userEvent.click(screen.getByRole("radio", { name: "Por producto" }));
    await waitFor(() =>
      expect(lib.leerInformacionProduccion).toHaveBeenLastCalledWith(INICIO, HOY, "TJ", "producto"),
    );
    await waitFor(() => expect(screen.queryByText("Total 500 ml")).toBeNull());
    const t = await tabla();
    expect(celdas(fila(t, "Horchata"))).toEqual(["Horchata", "150", "20", "170"]);
    expect(celdas(fila(t, "Total"))).toEqual(["Total", "200", "20", "220"]);
  });

  it("vacío", async () => {
    vi.mocked(lib.leerInformacionProduccion).mockResolvedValue({ ...DATOS, renglones: [] });
    render(<PantallaInformacionProduccion sucursal={null} />);
    expect(await screen.findByText("No hubo entradas en esas fechas.")).toBeInTheDocument();
  });

  it("error del servidor", async () => {
    vi.mocked(lib.leerInformacionProduccion).mockRejectedValue(new Error("Falló"));
    render(<PantallaInformacionProduccion sucursal={null} />);
    expect(await screen.findByText(/Falló|No se pudo/)).toBeInTheDocument();
  });

  it("cambiar de vista tras mover las fechas sin Mostrar consulta con el rango ya consultado", async () => {
    render(<PantallaInformacionProduccion sucursal={null} />);
    await tabla();
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2020-01-01" } });
    await userEvent.click(screen.getByRole("radio", { name: "Por producto" }));
    await waitFor(() =>
      expect(lib.leerInformacionProduccion).toHaveBeenLastCalledWith(INICIO, HOY, "TJ", "producto"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    await waitFor(() =>
      expect(lib.leerInformacionProduccion).toHaveBeenLastCalledWith("2020-01-01", HOY, "TJ", "producto"),
    );
  });

  it("Este mes y Esta semana no piden días futuros: Hasta se recorta a hoy", async () => {
    render(<PantallaInformacionProduccion sucursal={null} />);
    await tabla();
    await userEvent.click(screen.getByRole("button", { name: "Este mes" }));
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    await waitFor(() =>
      expect(lib.leerInformacionProduccion).toHaveBeenLastCalledWith(INICIO, HOY, "TJ", "presentacion"),
    );
    expect(screen.getByLabelText("Hasta")).toHaveValue(HOY);
    await userEvent.click(screen.getByRole("button", { name: "Esta semana" }));
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    await waitFor(() => {
      const [, hasta] = vi.mocked(lib.leerInformacionProduccion).mock.lastCall!;
      expect(hasta <= HOY).toBe(true);
    });
  });

  it("el detalle por presentación, con el rango consultado y sin columna Sucursal", async () => {
    vi.mocked(lib.leerDetalleInformacion).mockResolvedValue({
      detalle: [
        { fecha: HOY, hora: "10:05", sucursal: "TJ", origen: "produccion", capturo: "Ana", piezas: 100, comentario: "Turno 1" },
        { fecha: HOY, hora: "11:00", sucursal: "TJ", origen: "compra", capturo: "Luis", piezas: 20, comentario: null },
      ],
    });
    render(<PantallaInformacionProduccion sucursal={null} />);
    const t = await tabla();
    await userEvent.click(within(t).getByRole("button", { name: /Horchata/ }));
    await waitFor(() =>
      expect(lib.leerDetalleInformacion).toHaveBeenCalledWith({ presentacion: "p-Horchata-500 ml" }, INICIO, HOY, "TJ"),
    );
    const d = await screen.findByRole("table", { name: "Capturas" });
    expect(within(d).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Día",
      "Origen",
      "Capturó",
      "Piezas",
      "Comentario",
    ]);
    expect(within(d).getByText("Producción")).toBeInTheDocument();
    expect(within(d).getByText("Compra")).toBeInTheDocument();
    expect(within(d).getByText("Turno 1")).toBeInTheDocument();
    expect(celdas(within(d.querySelector("tfoot") as HTMLElement).getByText("Total").closest("tr") as HTMLElement)[0]).toBe("Total");
    expect(celdas(d.querySelector("tfoot tr") as HTMLElement)).toContain("120");
  });

  it("el detalle por producto llama con el producto, y con Todas trae la columna Sucursal", async () => {
    mockAuth([VER], null);
    vi.mocked(lib.leerDetalleInformacion).mockResolvedValue({
      detalle: [{ fecha: HOY, hora: "10:05", sucursal: "MX", origen: "compra", capturo: "Ana", piezas: 5, comentario: null }],
    });
    render(<PantallaInformacionProduccion sucursal={null} />);
    await waitFor(() => expect(lib.leerInformacionProduccion).toHaveBeenCalledWith(INICIO, HOY, "todas", "presentacion"));
    await tabla();
    await userEvent.click(screen.getByRole("radio", { name: "Por producto" }));
    await waitFor(() => expect(screen.queryByText("Total 500 ml")).toBeNull());
    const t = await tabla();
    await userEvent.click(within(t).getByRole("button", { name: /Horchata/ }));
    await waitFor(() =>
      expect(lib.leerDetalleInformacion).toHaveBeenCalledWith({ producto: "prod-Horchata" }, INICIO, HOY, "todas"),
    );
    const d = await screen.findByRole("table", { name: "Capturas" });
    expect(within(d).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Día",
      "Sucursal",
      "Origen",
      "Capturó",
      "Piezas",
      "Comentario",
    ]);
  });
});

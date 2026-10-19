import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorApi } from "@/lib/api";
import * as camposLib from "@/lib/campos-egreso";
import * as gastosLib from "@/lib/gastos";
import type { ListaGastos } from "@/lib/gastos";
import * as vendedoresLib from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaGastos } from "./pantalla-gastos";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/gastos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/gastos")>();
  return { ...real, obtenerGastos: vi.fn(), descargarFotoGasto: vi.fn() };
});
vi.mock("@/lib/vendedores", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vendedores")>();
  return { ...real, listarVendedores: vi.fn() };
});
vi.mock("@/lib/campos-egreso", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/campos-egreso")>();
  return { ...real, listarCamposEgreso: vi.fn() };
});

const obtener = vi.mocked(gastosLib.obtenerGastos);
const descargarFoto = vi.mocked(gastosLib.descargarFotoGasto);
const HOY = hoyEnTijuana();

const LISTA: ListaGastos = {
  desde: HOY,
  hasta: HOY,
  gastos: [
    {
      id: "g1",
      fecha: "2026-10-20",
      registradoEn: "2026-10-20T17:40:00.000Z",
      sucursalCodigo: "TJ",
      vendedorId: "v1",
      vendedorNombre: "Juan Pérez",
      campoEgresoId: "c1",
      campoNombre: "Gasolina",
      tipo: "operacion",
      montoCentavos: 25_050,
      comentario: "Pemex del bulevar",
      tieneFoto: true,
    },
    {
      id: "g2",
      fecha: "2026-10-20",
      registradoEn: "2026-10-20T18:05:00.000Z",
      sucursalCodigo: "TJ",
      vendedorId: "v1",
      vendedorNombre: "Juan Pérez",
      campoEgresoId: "c2",
      campoNombre: "Hielo",
      tipo: "operacion",
      montoCentavos: 8_000,
      comentario: null,
      tieneFoto: false,
    },
  ],
  totalCentavos: 33_050,
};

function sesion(puede: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    usuario: { sucursal: null, permisos: puede ? [gastosLib.PERMISO_VER_GASTOS] : [] } as never,
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: () => puede,
  });
}

describe("PantallaGastos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obtener.mockResolvedValue(LISTA);
    vi.mocked(vendedoresLib.listarVendedores).mockResolvedValue([
      { id: "v1", nombre: "Juan Pérez", login: "juan", sucursalId: "s1", sucursalCodigo: "TJ", folioSegmento: "JP", activo: true },
    ]);
    vi.mocked(camposLib.listarCamposEgreso).mockResolvedValue([
      { id: "c1", nombre: "Gasolina", tipo: "operacion", seUsaEnApp: true },
      { id: "c2", nombre: "Hielo", tipo: "operacion", seUsaEnApp: true },
    ]);
    URL.createObjectURL = vi.fn(() => "blob:ticket");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin gasto.ver lo dice y no consulta", async () => {
    sesion(false);
    render(<PantallaGastos sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver los gastos")).toBeInTheDocument();
    expect(obtener).not.toHaveBeenCalled();
  });

  it("al abrir consulta hoy en Tijuana con la sucursal del filtro global", async () => {
    sesion(true);
    render(<PantallaGastos sucursal="TJ" />);
    await within(await screen.findByRole("table", { name: "Gastos" })).findByText("Gasolina");
    expect(obtener).toHaveBeenCalledWith({ desde: HOY, hasta: HOY, sucursal: "TJ", vendedor: null, campo: null });
    expect(screen.getByLabelText("Desde")).toHaveValue(HOY);
    expect(screen.getByLabelText("Hasta")).toHaveValue(HOY);
  });

  it("pinta las columnas, la hora de Tijuana, el tipo con su etiqueta y el total", async () => {
    sesion(true);
    render(<PantallaGastos sucursal={null} />);
    const tabla = await screen.findByRole("table", { name: "Gastos" });
    expect(within(tabla).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Fecha", "Hora", "Sucursal", "Vendedor", "Campo", "Tipo", "Monto", "Comentario", "Ticket",
    ]);
    const fila = within(tabla).getByText("Gasolina").closest("tr")!;
    expect(within(fila).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "20/10/2026", "10:40", "TJ", "Juan Pérez", "Gasolina", "Operación", "$250.50", "Pemex del bulevar", "",
    ]);
    const sinFoto = within(tabla).getByText("Hielo").closest("tr")!;
    expect(within(sinFoto).queryByRole("button")).toBeNull();
    expect(within(sinFoto).getAllByRole("cell")[7]).toHaveTextContent("—");
    expect(screen.getByText("Total: $330.50 · 2 gastos")).toBeInTheDocument();
  });

  it("Mostrar manda los filtros de vendedor y campo", async () => {
    sesion(true);
    render(<PantallaGastos sucursal={null} />);
    await within(await screen.findByRole("table", { name: "Gastos" })).findByText("Gasolina");
    await userEvent.selectOptions(screen.getByLabelText("Vendedor"), "v1");
    await userEvent.selectOptions(screen.getByLabelText("Campo"), "c2");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(obtener).toHaveBeenLastCalledWith({ desde: HOY, hasta: HOY, sucursal: null, vendedor: "v1", campo: "c2" });
  });

  it("desde posterior a hasta no consulta y lo dice", async () => {
    sesion(true);
    render(<PantallaGastos sucursal={null} />);
    await within(await screen.findByRole("table", { name: "Gastos" })).findByText("Gasolina");
    // `fireEvent` y no `userEvent.type`: jsdom no teclea en un <input type="date">.
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2099-01-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior a la final.");
    expect(obtener).toHaveBeenCalledTimes(1);
  });

  it("el error del servidor (rango de más de un año) se muestra tal cual", async () => {
    sesion(true);
    obtener.mockRejectedValue(new ErrorApi("mal", 400, "El rango no puede pasar de un año."));
    render(<PantallaGastos sucursal={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("El rango no puede pasar de un año.");
  });

  it("sin gastos en el rango lo dice", async () => {
    sesion(true);
    obtener.mockResolvedValue({ desde: HOY, hasta: HOY, gastos: [], totalCentavos: 0 });
    render(<PantallaGastos sucursal={null} />);
    expect(await screen.findByText("No hay gastos en ese rango.")).toBeInTheDocument();
  });

  it("el ícono del ticket baja la foto y la abre; Cerrar la quita", async () => {
    sesion(true);
    descargarFoto.mockResolvedValue(new Blob(["jpeg"]));
    render(<PantallaGastos sucursal={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver el ticket de Gasolina" }));
    expect(descargarFoto).toHaveBeenCalledWith("g1");
    const dialogo = await screen.findByRole("dialog", { name: "Ticket de Gasolina" });
    expect(within(dialogo).getByAltText("Ticket de Gasolina")).toHaveAttribute("src", "blob:ticket");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("si la foto no baja, lo dice sin romper la tabla", async () => {
    sesion(true);
    descargarFoto.mockRejectedValue(new ErrorApi("no", 404, "Ese gasto no tiene foto."));
    render(<PantallaGastos sucursal={null} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver el ticket de Gasolina" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el ticket.");
    expect(screen.getByRole("table", { name: "Gastos" })).toBeInTheDocument();
  });
});

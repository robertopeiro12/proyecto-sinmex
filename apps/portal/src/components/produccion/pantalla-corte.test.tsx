import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/components/auth/auth-provider";
import * as lib from "@/lib/cortes";
import type { CortesDelDia, CorteVendedor, FilaCorte } from "@/lib/cortes";
import { diaAnterior } from "@/lib/fechas";
import * as productosLib from "@/lib/productos";
import * as sucursalesLib from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { PantallaCorte } from "./pantalla-corte";

vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/cortes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cortes")>();
  return { ...real, leerCortesDelDia: vi.fn(), leerCorteVendedor: vi.fn(), guardarCorteVendedor: vi.fn() };
});
vi.mock("@/lib/sucursales", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sucursales")>();
  return { ...real, listarSucursales: vi.fn() };
});
vi.mock("@/lib/productos", () => ({ listarProductos: vi.fn() }));

const HOY = hoyEnTijuana();
const PERMISO = "retorno.gestionar";

function mockAuth(permisos: string[], codigoSucursal: string | null = "TJ") {
  vi.mocked(useAuth).mockReturnValue({
    usuario: {
      id: "u1", login: "ana", nombre: "Ana", perfil: "Administrador General",
      sucursal: codigoSucursal ? { id: "s", codigo: codigoSucursal, nombre: codigoSucursal } : null,
      permisos,
    },
    cargando: false,
    cerrarSesion: vi.fn(),
    puede: (clave: string) => permisos.includes(clave),
  });
}

const fila = (id: string, nombre: string, codigo: string, m: Partial<FilaCorte> = {}): FilaCorte => ({
  vendedor: { id, nombre },
  sucursal: { id: `s-${codigo}`, codigo },
  piezasCargadas: 40,
  estado: "sin_corte",
  sinCarga: false,
  piezasFaltantes: null,
  hechoEn: null,
  ...m,
});

const lista = (vendedores: FilaCorte[], fecha = HOY): CortesDelDia => ({ fecha, hoy: HOY, vendedores });

const corteVacio: CorteVendedor = {
  fecha: HOY,
  hoy: HOY,
  vendedor: { id: "v1", nombre: "Ana Pérez" },
  sucursal: { id: "s-TJ", codigo: "TJ" },
  lineas: [],
  totales: { cargadas: 0, vendidas: 0, regaladas: 0, deberiaRegresar: 0, buenas: 0, merma: 0, faltante: null },
  hecho: null,
};

describe("PantallaCorte (lista del día)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue([
      { id: "s-TJ", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false },
      { id: "s-MX", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
    ]);
    vi.mocked(productosLib.listarProductos).mockResolvedValue([]);
    vi.mocked(lib.leerCorteVendedor).mockResolvedValue(corteVacio);
    vi.mocked(lib.leerCortesDelDia).mockResolvedValue(
      lista([
        fila("v1", "Ana Pérez", "TJ"),
        fila("v2", "Beto Ruiz", "TJ", { estado: "hecho", piezasFaltantes: 0, hechoEn: "2026-11-12T20:00:00Z" }),
        fila("v3", "Cata Lara", "TJ", { estado: "con_faltante", piezasFaltantes: 4, hechoEn: "2026-11-12T20:00:00Z" }),
        fila("v4", "Dani Soto", "TJ", { sinCarga: true, piezasCargadas: 0 }),
      ]),
    );
  });

  it("sin permiso dice que no hay permiso y no consulta", () => {
    mockAuth([]);
    render(<PantallaCorte sucursal={null} />);
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(lib.leerCortesDelDia).not.toHaveBeenCalled();
  });

  it("encabezado, hoy por omisión y la sucursal del usuario atado", async () => {
    mockAuth([PERMISO], "TJ");
    render(<PantallaCorte sucursal="MX" />);
    expect(screen.getByRole("heading", { name: "Corte" })).toBeInTheDocument();
    expect(
      screen.getByText("Compara lo que debería regresar cada vendedor contra lo que contó el almacén."),
    ).toBeInTheDocument();
    await screen.findByRole("table", { name: "Vendedores del día" });
    expect(lib.leerCortesDelDia).toHaveBeenCalledWith(HOY, "TJ");
    expect(screen.getByLabelText("Día")).toHaveAttribute("max", HOY);
  });

  it("cada vendedor con su estado, Sin carga y el botón según el estado", async () => {
    mockAuth([PERMISO]);
    render(<PantallaCorte sucursal={null} />);
    await screen.findByRole("table", { name: "Vendedores del día" });
    const renglon = (nombre: string) => within(screen.getByRole("row", { name: new RegExp(nombre) }));
    expect(renglon("Ana Pérez").getByText("Sin corte")).toBeInTheDocument();
    expect(renglon("Ana Pérez").getByText("40")).toBeInTheDocument();
    expect(renglon("Ana Pérez").getByRole("button", { name: "Hacer corte" })).toBeInTheDocument();
    expect(renglon("Beto Ruiz").getByText("Corte hecho")).toBeInTheDocument();
    expect(renglon("Beto Ruiz").getByRole("button", { name: "Ver corte" })).toBeInTheDocument();
    expect(renglon("Cata Lara").getByText("Faltan 4")).toHaveAttribute("data-tono", "error");
    expect(renglon("Dani Soto").getByText("Sin carga")).toBeInTheDocument();
  });

  it("Ayer cambia el día; un día futuro tecleado no se pide", async () => {
    mockAuth([PERMISO]);
    render(<PantallaCorte sucursal={null} />);
    await screen.findByRole("table", { name: "Vendedores del día" });
    await userEvent.click(screen.getByRole("button", { name: "Ayer" }));
    await waitFor(() => expect(lib.leerCortesDelDia).toHaveBeenLastCalledWith(diaAnterior(HOY), "TJ"));
    fireEvent.change(screen.getByLabelText("Día"), { target: { value: "2999-01-01" } });
    await waitFor(() => expect(screen.getByLabelText("Día")).toHaveValue(diaAnterior(HOY)));
    expect(vi.mocked(lib.leerCortesDelDia).mock.calls.some(([f]) => f === "2999-01-01")).toBe(false);
  });

  it("con Todas, un bloque por sucursal con su nombre", async () => {
    mockAuth([PERMISO], null);
    vi.mocked(lib.leerCortesDelDia).mockResolvedValue(
      lista([fila("v1", "Ana Pérez", "MX"), fila("v2", "Beto Ruiz", "TJ")]),
    );
    render(<PantallaCorte sucursal="todas" />);
    await screen.findByRole("table", { name: "Vendedores del día" });
    expect(lib.leerCortesDelDia).toHaveBeenCalledWith(HOY, null);
    expect(await screen.findByRole("rowheader", { name: "Mexicali" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Tijuana" })).toBeInTheDocument();
  });

  it("General con una sucursal elegida no agrupa", async () => {
    mockAuth([PERMISO], null);
    render(<PantallaCorte sucursal="tj" />);
    await screen.findByRole("table", { name: "Vendedores del día" });
    expect(lib.leerCortesDelDia).toHaveBeenCalledWith(HOY, "TJ");
    expect(screen.queryByRole("rowheader")).toBeNull();
  });

  it("sin vendedores lo dice", async () => {
    mockAuth([PERMISO]);
    vi.mocked(lib.leerCortesDelDia).mockResolvedValue(lista([]));
    render(<PantallaCorte sucursal={null} />);
    expect(await screen.findByText("Nadie cargó, vendió ni regresó mercancía ese día.")).toBeInTheDocument();
  });

  it("Hacer corte abre el corte del vendedor y Volver regresa a la lista y la vuelve a pedir", async () => {
    mockAuth([PERMISO]);
    render(<PantallaCorte sucursal={null} />);
    await screen.findByRole("table", { name: "Vendedores del día" });
    await userEvent.click(
      within(screen.getByRole("row", { name: /Ana Pérez/ })).getByRole("button", { name: "Hacer corte" }),
    );
    expect(await screen.findByRole("heading", { name: "Corte · Ana Pérez" })).toBeInTheDocument();
    expect(lib.leerCorteVendedor).toHaveBeenCalledWith(HOY, "v1");
    const antes = vi.mocked(lib.leerCortesDelDia).mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "← Volver a Corte" }));
    await screen.findByRole("table", { name: "Vendedores del día" });
    expect(vi.mocked(lib.leerCortesDelDia).mock.calls.length).toBe(antes + 1);
  });
});

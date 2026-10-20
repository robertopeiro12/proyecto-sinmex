import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import type { UsuarioSesion } from "@/lib/api";
import * as sucursalesLib from "@/lib/sucursales";
import type { Sucursal } from "@/lib/sucursales";
import { NOMBRE_TODAS, useSucursalActual } from "./use-sucursal-actual";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(), useRouter: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("@/components/auth/auth-provider");
vi.mock("@/lib/sucursales", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales")>()),
  listarSucursales: vi.fn(),
}));

const SUCURSALES: Sucursal[] = [
  { id: "s1", codigo: "TJ", nombre: "Tijuana", activa: true, controlInventario: false },
  { id: "s2", codigo: "MX", nombre: "Mexicali", activa: true, controlInventario: false },
  { id: "s3", codigo: "EN", nombre: "Ensenada", activa: true, controlInventario: false },
  { id: "s4", codigo: "BC", nombre: "Baja", activa: false, controlInventario: false },
];
const GENERAL: UsuarioSesion = { id: "u1", login: "admin", nombre: "Admin Local", perfil: "Administrador General", sucursal: null, permisos: [] };
const ATADO: UsuarioSesion = { ...GENERAL, id: "u2", sucursal: { id: "s1", codigo: "TJ", nombre: "Tijuana" } };

const push = vi.fn();

function preparar(query: string, usuario: UsuarioSesion | null = GENERAL, ruta = "/operacion/ventas") {
  vi.mocked(usePathname).mockReturnValue(ruta);
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>);
  vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(useAuth).mockReturnValue({ usuario, cargando: false, cerrarSesion: vi.fn(), puede: () => true });
}

describe("useSucursalActual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sucursalesLib.listarSucursales).mockResolvedValue(SUCURSALES);
  });

  it("General con ?sucursal=TJ: Tijuana en su color, y puede elegir entre las activas", async () => {
    preparar("sucursal=TJ");
    const { result } = renderHook(() => useSucursalActual());
    expect(result.current.codigo).toBe("TJ");
    await waitFor(() => expect(result.current.nombre).toBe("Tijuana"));
    expect(result.current.color).toBe("var(--suc-tj)");
    expect(result.current.siglas).toBe("TJ");
    expect(result.current.puedeElegir).toBe(true);
    expect(result.current.opciones.map((s) => s.codigo)).toEqual(["TJ", "MX", "EN"]);
    // Sin filtro a propósito: se pide todo lo que el usuario puede elegir.
    expect(sucursalesLib.listarSucursales).toHaveBeenCalledWith();
  });

  it("sin parámetro, o con ?sucursal=TODAS, son todas las sucursales en tinta", async () => {
    preparar("");
    const sin = renderHook(() => useSucursalActual());
    expect(sin.result.current).toMatchObject({ codigo: null, nombre: NOMBRE_TODAS, siglas: "Todas", color: "var(--suc-todas)" });
    sin.unmount();
    preparar("sucursal=TODAS");
    const todas = renderHook(() => useSucursalActual());
    expect(todas.result.current.codigo).toBeNull();
    await waitFor(() => expect(todas.result.current.puedeElegir).toBe(true));
  });

  it("Review Focus 3: ?sucursal=en (minúsculas, sin color asignado) es Ensenada en tinta", async () => {
    preparar("sucursal=en");
    const { result } = renderHook(() => useSucursalActual());
    await waitFor(() => expect(result.current.nombre).toBe("Ensenada"));
    expect(result.current.codigo).toBe("EN");
    expect(result.current.color).toBe("var(--suc-todas)");
  });

  it("un usuario atado ve la suya aunque la dirección diga otra, y no elige", async () => {
    preparar("sucursal=MX", ATADO);
    const { result } = renderHook(() => useSucursalActual());
    expect(result.current).toMatchObject({ codigo: "TJ", nombre: "Tijuana", color: "var(--suc-tj)" });
    await waitFor(() => expect(sucursalesLib.listarSucursales).toHaveBeenCalled());
    expect(result.current.puedeElegir).toBe(false);
  });

  it("elegir cambia ?sucursal= y conserva lo demás; todas lo quita", () => {
    preparar("sucursal=TJ&vista=movimientos", GENERAL, "/finanzas/tesoreria");
    const { result } = renderHook(() => useSucursalActual());
    act(() => result.current.elegir("MX"));
    expect(push).toHaveBeenLastCalledWith("/finanzas/tesoreria?sucursal=MX&vista=movimientos");
    act(() => result.current.elegir(null));
    expect(push).toHaveBeenLastCalledWith("/finanzas/tesoreria?vista=movimientos");
  });

  it("si la lista no carga se queda con el código y no ofrece elegir", async () => {
    vi.mocked(sucursalesLib.listarSucursales).mockRejectedValue(new Error("red"));
    preparar("sucursal=TJ");
    const { result } = renderHook(() => useSucursalActual());
    await waitFor(() => expect(sucursalesLib.listarSucursales).toHaveBeenCalled());
    expect(result.current.nombre).toBe("TJ");
    expect(result.current.puedeElegir).toBe(false);
  });

  it("sin sesión todavía no pide la lista", () => {
    preparar("", null);
    renderHook(() => useSucursalActual());
    expect(sucursalesLib.listarSucursales).not.toHaveBeenCalled();
  });
});

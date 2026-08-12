import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCatalogo } from "./use-catalogo";

interface Fila {
  id: string;
  nombre: string;
}

const UNA_FILA: Fila[] = [{ id: "1", nombre: "Jamaica" }];

describe("useCatalogo", () => {
  it("carga los items al montar", async () => {
    const cargar = vi.fn().mockResolvedValue(UNA_FILA);

    const { result } = renderHook(() =>
      useCatalogo<Fila>(cargar, { mensajeError: "No se pudo." }),
    );

    expect(result.current.cargando).toBe(true);
    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(result.current.items).toEqual(UNA_FILA);
    expect(result.current.error).toBeNull();
  });

  it("expone el mensaje de error cuando la carga falla", async () => {
    const cargar = vi.fn().mockRejectedValue(new Error("red caida"));

    const { result } = renderHook(() =>
      useCatalogo<Fila>(cargar, { mensajeError: "No se pudieron cargar." }),
    );

    await waitFor(() => expect(result.current.error).toBe("No se pudieron cargar."));
    expect(result.current.items).toEqual([]);
    expect(result.current.cargando).toBe(false);
  });

  /**
   * El trampa que se lleva por delante a cualquiera que use el hook: si
   * `cargar` va inline (`() => listarProductos()`), cambia de identidad en cada
   * render. Metido tal cual en las deps del useEffect, eso es un bucle
   * infinito de peticiones. El hook lo guarda en un ref.
   */
  it("no recarga cuando `cargar` cambia de identidad en cada render", async () => {
    const espia = vi.fn().mockResolvedValue(UNA_FILA);

    const { result, rerender } = renderHook(() =>
      useCatalogo<Fila>(() => espia(), { mensajeError: "No se pudo." }),
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));
    rerender();
    rerender();

    expect(espia).toHaveBeenCalledTimes(1);
  });

  it("recarga cuando cambia algo de `deps`", async () => {
    const espia = vi.fn().mockResolvedValue(UNA_FILA);
    let sucursal = "TJ";

    const { result, rerender } = renderHook(() =>
      useCatalogo<Fila>(() => espia(sucursal), {
        mensajeError: "No se pudo.",
        deps: [sucursal],
      }),
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));
    sucursal = "MX";
    rerender();

    await waitFor(() => expect(espia).toHaveBeenCalledTimes(2));
    expect(espia).toHaveBeenLastCalledWith("MX");
  });

  it("abre y cierra el formulario de alta y de edicion", async () => {
    const cargar = vi.fn().mockResolvedValue(UNA_FILA);
    const { result } = renderHook(() =>
      useCatalogo<Fila>(cargar, { mensajeError: "No se pudo." }),
    );
    await waitFor(() => expect(result.current.cargando).toBe(false));

    expect(result.current.edicion).toBeNull();

    act(() => result.current.abrirAlta());
    expect(result.current.edicion).toBe("nueva");

    act(() => result.current.abrirEdicion(UNA_FILA[0]));
    expect(result.current.edicion).toEqual(UNA_FILA[0]);

    act(() => result.current.cerrar());
    expect(result.current.edicion).toBeNull();
  });

  it("limpia el error de una carga fallida al recargar con exito", async () => {
    const cargar = vi
      .fn()
      .mockRejectedValueOnce(new Error("red caida"))
      .mockResolvedValueOnce(UNA_FILA);

    const { result } = renderHook(() =>
      useCatalogo<Fila>(cargar, { mensajeError: "No se pudo." }),
    );
    await waitFor(() => expect(result.current.error).toBe("No se pudo."));

    await act(async () => {
      await result.current.recargar();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual(UNA_FILA);
  });
});

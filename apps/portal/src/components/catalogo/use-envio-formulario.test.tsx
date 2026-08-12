import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ErrorApi } from "@/lib/api";
import { useEnvioFormulario } from "./use-envio-formulario";

describe("useEnvioFormulario", () => {
  it("llama a alTerminar cuando la accion sale bien", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));
    const alTerminar = vi.fn();

    await act(async () => {
      await result.current.enviar(() => Promise.resolve(), alTerminar);
    });

    expect(alTerminar).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.enviando).toBe(false);
  });

  /**
   * El mensaje del servidor se muestra tal cual cuando existe: el 409 dice
   * exactamente que nombre esta repetido y el 400 dice que campo fallo. Es
   * mucho mas util que un texto generico.
   */
  it("muestra el mensaje del servidor cuando llega un ErrorApi", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));

    await act(async () => {
      await result.current.enviar(
        () =>
          Promise.reject(
            // Firma real: ErrorApi(message, status, mensajeApi?).
            new ErrorApi(
              "La peticion a /productos fallo",
              409,
              'Ya existe un producto llamado "Jamaica".',
            ),
          ),
        vi.fn(),
      );
    });

    expect(result.current.error).toBe('Ya existe un producto llamado "Jamaica".');
  });

  it("cae al mensaje de respaldo si el ErrorApi no trae mensajeApi", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));

    await act(async () => {
      await result.current.enviar(
        () => Promise.reject(new ErrorApi("La peticion fallo", 500)),
        vi.fn(),
      );
    });

    // Un 500 no trae cuerpo legible: ahi si toca el texto generico del catalogo.
    expect(result.current.error).toBe("No se pudo guardar.");
  });

  it("usa el mensaje de respaldo cuando el fallo no es del servidor", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));

    await act(async () => {
      await result.current.enviar(() => Promise.reject(new TypeError("fetch failed")), vi.fn());
    });

    expect(result.current.error).toBe(
      "No se pudo conectar con el servidor. Intenta de nuevo.",
    );
  });

  it("no llama a alTerminar cuando la accion falla", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));
    const alTerminar = vi.fn();

    await act(async () => {
      await result.current.enviar(() => Promise.reject(new Error("x")), alTerminar);
    });

    expect(alTerminar).not.toHaveBeenCalled();
  });

  it("marca enviando mientras la accion esta en vuelo", async () => {
    const { result } = renderHook(() => useEnvioFormulario("No se pudo guardar."));
    let resolver: () => void = () => {};
    const enVuelo = new Promise<void>((r) => {
      resolver = r;
    });

    act(() => {
      void result.current.enviar(() => enVuelo, vi.fn());
    });

    await waitFor(() => expect(result.current.enviando).toBe(true));

    await act(async () => {
      resolver();
      await enVuelo;
    });

    expect(result.current.enviando).toBe(false);
  });
});

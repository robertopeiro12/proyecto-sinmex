"use client";

import { useCallback, useState } from "react";
import { ErrorApi } from "@/lib/api";

/**
 * La plomeria que rodea a los campos de cualquier formulario de catalogo:
 * el "Guardando…", el mensaje de error y la traduccion de ErrorApi.
 *
 * Los CAMPOS no se abstraen (D9): sucursal tiene un codigo de 2 letras de solo
 * lectura y producto una lista dinamica de presentaciones. Un motor generico de
 * formularios seria peor que copiar.
 */
export function useEnvioFormulario(mensajeFallback: string) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = useCallback(
    async (accion: () => Promise<unknown>, alTerminar: () => void) => {
      setError(null);
      setEnviando(true);
      try {
        await accion();
        alTerminar();
      } catch (err) {
        // El mensaje del servidor se muestra tal cual cuando existe: el 409
        // dice exactamente que esta repetido y el 400 que campo fallo.
        setError(
          err instanceof ErrorApi
            ? (err.mensajeApi ?? mensajeFallback)
            : "No se pudo conectar con el servidor. Intenta de nuevo.",
        );
      } finally {
        setEnviando(false);
      }
    },
    [mensajeFallback],
  );

  return { enviando, error, enviar };
}

"use client";

import { useEffect, useState } from "react";
import { descargarFotoCliente } from "@/lib/clientes";

interface Props {
  clienteId: string;
  /** Viene del detalle. Si es `false`, este componente **no dibuja nada**. */
  tieneFoto: boolean;
  /** Cuándo la recibió el servidor, en ISO. Solo para mostrarla como pie. */
  fotoSubidaEn: string | null;
  /** Nombre del negocio, para el texto alternativo y el aria-label. */
  nombre: string;
}

/**
 * La foto del lugar que tomó el vendedor al registrar el prospecto (T-40).
 *
 * Miniatura ampliable. Tres decisiones que no son cosméticas:
 *
 * 1. **Si no hay foto no se dibuja nada.** Ni marco vacío, ni un "sin foto", ni
 *    un hueco reservado. La foto es opcional —el cliente la pidió condicionada a
 *    que no hiciera lento el alta— y la mayoría de los prospectos no la tendrá:
 *    un hueco por cada uno sería ruido permanente en la pantalla, y peor, daría
 *    a entender que falta algo. **Un prospecto sin foto es un prospecto
 *    completo.**
 * 2. **Los bytes se piden con `fetch`, no con un `<img src>` a la API.** Un
 *    `<img>` no sabe hacer el refresco de sesión, así que pasados los 15 minutos
 *    del access token la miniatura saldría rota sin ningún error visible. Ver
 *    `apiFetchBlob`.
 * 3. **Un fallo al cargar la foto no dice "error".** Si la imagen no baja
 *    (se perdió el archivo del disco, se cayó la red) se muestra una línea
 *    discreta y el resto del formulario sigue igual: la foto es un extra, no un
 *    dato del que dependa nada.
 */
export function FotoProspecto({ clienteId, tieneFoto, fotoSubidaEn, nombre }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const [ampliada, setAmpliada] = useState(false);

  useEffect(() => {
    if (!tieneFoto) return;

    let vigente = true;
    // La URL de objeto se guarda también aquí, y no solo en el estado, porque la
    // limpieza tiene que poder revocarla incluso si el componente se desmonta
    // antes de que el `setUrl` llegue a pintar: sin eso, el Blob se queda en
    // memoria del navegador hasta que se recargue la página.
    let creada: string | null = null;

    descargarFotoCliente(clienteId)
      .then((blob) => {
        if (!vigente) return;
        creada = URL.createObjectURL(blob);
        setUrl(creada);
      })
      .catch(() => {
        if (vigente) setFallo(true);
      });

    return () => {
      vigente = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [clienteId, tieneFoto]);

  // Cerrar la vista ampliada con Escape. El efecto solo se engancha mientras
  // está abierta para no dejar un listener global vivo en cada formulario.
  useEffect(() => {
    if (!ampliada) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setAmpliada(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [ampliada]);

  // La regla del punto 1: sin foto, nada. Va antes que cualquier otro retorno.
  if (!tieneFoto) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">Foto del lugar</p>

      {fallo && (
        <p className="text-xs text-muted-foreground">
          No se pudo cargar la foto de este prospecto.
        </p>
      )}

      {!fallo && url === null && (
        <p className="text-xs text-muted-foreground">Cargando la foto…</p>
      )}

      {url !== null && (
        <>
          <button
            type="button"
            onClick={() => setAmpliada(true)}
            aria-label={`Ampliar la foto de ${nombre}`}
            className="w-fit rounded-md border p-1"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- el src es
                una URL de objeto (blob:) creada en el navegador: next/image
                optimiza en el servidor y no puede ver estos bytes. */}
            <img
              src={url}
              alt={`Foto del lugar de ${nombre}`}
              className="h-24 w-32 rounded object-cover"
            />
          </button>
          {fotoSubidaEn !== null && (
            <p className="text-xs text-muted-foreground">
              Subida el {new Date(fotoSubidaEn).toLocaleDateString()}
            </p>
          )}
        </>
      )}

      {ampliada && url !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Foto de ${nombre}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- mismo motivo
              que arriba: el src es un blob: del navegador. */}
          <img
            src={url}
            alt={`Foto del lugar de ${nombre}`}
            className="max-h-full max-w-full rounded"
          />
          <button
            type="button"
            onClick={() => setAmpliada(false)}
            className="absolute right-4 top-4 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black"
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}

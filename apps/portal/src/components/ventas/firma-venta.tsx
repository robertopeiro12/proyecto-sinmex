"use client";

import { useEffect, useState } from "react";
import { descargarFirmaVenta, type FirmaDeVenta } from "@/lib/ventas";

/**
 * La firma del cliente en el detalle de la venta (T-73). Tres estados, del
 * servidor (`firma.esperada`, `firma.subidaEn`): subida, pendiente de subir o
 * sin firma (venta del portal o de una app anterior).
 *
 * Los bytes se piden con `fetch` y se pintan con una URL de objeto que se revoca
 * al desmontar, como `FotoProspecto`. Fondo blanco y borde: la firma es un papel.
 */
export function FirmaVenta({
  ventaId,
  firma,
  editada,
}: {
  ventaId: string;
  firma: FirmaDeVenta;
  editada: boolean;
}) {
  const subida = firma.subidaEn !== null;
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    if (!subida) return;
    let vigente = true;
    let creada: string | null = null;
    descargarFirmaVenta(ventaId)
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
  }, [ventaId, subida]);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Firma del cliente</h3>

      {subida && (
        <>
          {fallo && <p className="text-sm text-muted-foreground">No se pudo cargar la firma.</p>}
          {!fallo && url === null && <p className="text-sm text-muted-foreground">Cargando la firma…</p>}
          {url !== null && (
            /* eslint-disable-next-line @next/next/no-img-element -- el src es
               una URL de objeto (blob:) creada en el navegador: next/image
               optimiza en el servidor y no puede ver estos bytes. */
            <img
              src={url}
              alt="Firma del cliente"
              className="max-h-40 w-fit max-w-full rounded-md border bg-white object-contain p-1"
            />
          )}
          {firma.nombre && <p className="text-sm">{`Firmó: ${firma.nombre}`}</p>}
          <p className="text-sm text-muted-foreground">Firmada en la tablet</p>
        </>
      )}

      {!subida && firma.esperada && (
        <p className="text-sm text-muted-foreground">
          Firma pendiente de subir: llega cuando el vendedor sincronice.
        </p>
      )}

      {!firma.esperada && (
        <p className="text-sm text-muted-foreground">
          Sin firma (venta capturada en oficina o anterior a la firma en tablet).
        </p>
      )}

      {firma.esperada && editada && (
        <p role="note" className="rounded-md border p-3 text-sm">
          Esta nota se editó en el portal después de firmarse; la firma corresponde a la versión original.
        </p>
      )}
    </section>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { armadaPorElVendedor, type FilaEditable } from "@/lib/rutas";

/**
 * La columna derecha de Ruta Diaria (D17): la ruta numerada, con subir / bajar /
 * quitar. Lo que agregó el vendedor lleva su etiqueta y NO se puede quitar
 * (D2, D14), solo reordenar.
 */
export function ListaRutaDiaria({
  filas,
  onMover,
  onQuitar,
}: {
  filas: FilaEditable[];
  onMover: (desde: number, hasta: number) => void;
  onQuitar: (indice: number) => void;
}) {
  return (
    <section aria-label="Ruta del día" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        {armadaPorElVendedor(filas) ? "Ruta armada por el vendedor" : "Ruta del día"}
      </h3>
      {filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin clientes en la ruta. Agrégalos desde la cartera.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {filas.map((f, i) => (
            <li key={f.clienteId} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <span className="w-6 text-right tabular-nums">{i + 1}</span>
              <span className="flex-1">{f.clienteNombre}</span>
              {f.origen === "vendedor" ? (
                <span className="rounded bg-muted px-2 py-0.5 text-xs">agregada por el vendedor</span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Subir ${f.clienteNombre}`}
                disabled={i === 0}
                onClick={() => onMover(i, i - 1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Bajar ${f.clienteNombre}`}
                disabled={i === filas.length - 1}
                onClick={() => onMover(i, i + 1)}
              >
                ↓
              </Button>
              {f.origen === "oficina" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Quitar ${f.clienteNombre}`}
                  onClick={() => onQuitar(i)}
                >
                  Quitar
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

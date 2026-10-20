"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import type { ClienteResumen } from "@/lib/clientes";
import { normalizarTexto } from "@/lib/ventas";

/**
 * Búsqueda incremental de cliente por nombre (T-17). La usan "Registrar venta"
 * y la búsqueda de ventas; `clientes` ya viene acotado al alcance del usuario.
 */
export function BuscadorCliente({
  clientes,
  cliente,
  onElegir,
  onQuitar,
  etiquetaQuitar = "Cambiar",
  disabled = false,
}: {
  clientes: ClienteResumen[];
  cliente: ClienteResumen | null;
  onElegir: (cliente: ClienteResumen) => void;
  onQuitar: () => void;
  etiquetaQuitar?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [busqueda, setBusqueda] = useState("");

  const coincidencias = useMemo(() => {
    const q = normalizarTexto(busqueda.trim());
    if (q === "") return [];
    return clientes.filter((c) => normalizarTexto(c.nombre).includes(q)).slice(0, 10);
  }, [busqueda, clientes]);

  const etiqueta = (c: ClienteResumen) =>
    `${c.nombre} · ${c.sucursalCodigo}${c.tipo === "prospecto" ? " · Prospecto" : ""}`;

  return (
    <Campo id={id} etiqueta="Cliente" className="w-72">
      {cliente ? (
        <div className="flex items-center gap-2 text-sm">
          <span>{etiqueta(cliente)}</span>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onQuitar}>
            {etiquetaQuitar}
          </Button>
        </div>
      ) : (
        <>
          <Entrada
            autoComplete="off"
            placeholder="Escribe el nombre del cliente"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          {coincidencias.length > 0 && (
            <ul className="flex flex-col rounded-md border">
              {coincidencias.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setBusqueda("");
                      onElegir(c);
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {etiqueta(c)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Campo>
  );
}

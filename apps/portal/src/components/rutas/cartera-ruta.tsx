"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ClienteResumen } from "@/lib/clientes";
import { filtrarCartera } from "@/lib/rutas";

/**
 * La columna izquierda de Ruta Diaria (D17): clientes activos de la sucursal del
 * vendedor que no están en la ruta, con buscador y "Agregar".
 */
export function CarteraRuta({
  cartera,
  enRuta,
  onAgregar,
}: {
  cartera: ClienteResumen[];
  enRuta: ReadonlySet<string>;
  onAgregar: (cliente: ClienteResumen) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const visibles = useMemo(() => filtrarCartera(cartera, enRuta, busqueda), [cartera, enRuta, busqueda]);

  return (
    <section aria-label="Cartera de clientes" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Cartera de clientes</h3>
      <label htmlFor="buscar-cartera" className="text-sm font-medium">
        Buscar cliente
      </label>
      <input
        id="buscar-cartera"
        autoComplete="off"
        placeholder="Escribe el nombre del cliente"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="rounded-md border px-3 py-2 text-sm"
      />
      {visibles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún cliente disponible.</p>
      ) : (
        <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
          {visibles.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
              <span className="flex-1">{c.nombre}</span>
              <Button type="button" size="sm" aria-label={`Agregar ${c.nombre}`} onClick={() => onAgregar(c)}>
                Agregar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

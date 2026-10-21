"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
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
      <h2 className="text-base font-semibold">Cartera de clientes</h2>
      <Campo id="buscar-cartera" etiqueta="Buscar cliente">
        <Entrada
          autoComplete="off"
          placeholder="Escribe el nombre del cliente"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </Campo>
      {visibles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún cliente disponible.</p>
      ) : (
        <ul className="max-h-[28rem] divide-y overflow-y-auto rounded-[10px] border">
          {visibles.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
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

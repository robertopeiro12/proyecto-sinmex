"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AsignarFactura } from "./asignar-factura";
import { BuscarFacturas } from "./buscar-facturas";

type Pestana = "asignar" | "buscar";
const PESTANAS: { clave: Pestana; texto: string }[] = [
  { clave: "asignar", texto: "Asignar" },
  { clave: "buscar", texto: "Buscar y corregir" },
];

/** Operación → Facturas (T-19): asignar, y buscar y corregir. */
export function PantallaFacturas({ sucursal }: { sucursal: string | null }) {
  const [pestana, setPestana] = useState<Pestana>("asignar");
  const botones = useRef<Record<Pestana, HTMLButtonElement | null>>({ asignar: null, buscar: null });

  // Flechas izquierda/derecha cambian de pestaña y mueven el foco (patrón ARIA de tabs).
  function alTeclear(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight") return;
    evento.preventDefault();
    const siguiente = PESTANAS[(PESTANAS.findIndex((p) => p.clave === pestana) + 1) % PESTANAS.length].clave;
    setPestana(siguiente);
    botones.current[siguiente]?.focus();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Facturas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="tablist" className="flex gap-2" onKeyDown={alTeclear}>
          {PESTANAS.map(({ clave, texto }) => (
            <button
              key={clave}
              type="button"
              role="tab"
              id={`pestana-${clave}`}
              aria-controls={`panel-${clave}`}
              aria-selected={pestana === clave}
              tabIndex={pestana === clave ? 0 : -1}
              ref={(el) => {
                botones.current[clave] = el;
              }}
              onClick={() => setPestana(clave)}
              className={`rounded-md border px-3 py-1.5 text-sm ${pestana === clave ? "bg-muted font-medium" : ""}`}
            >
              {texto}
            </button>
          ))}
        </div>
        {/* Los dos paneles quedan montados: cambiar de pestaña no debe borrar lo marcado. */}
        <div role="tabpanel" id="panel-asignar" aria-labelledby="pestana-asignar" hidden={pestana !== "asignar"}>
          <AsignarFactura sucursal={sucursal} />
        </div>
        <div role="tabpanel" id="panel-buscar" aria-labelledby="pestana-buscar" hidden={pestana !== "buscar"}>
          <BuscarFacturas sucursal={sucursal} />
        </div>
      </CardContent>
    </Card>
  );
}

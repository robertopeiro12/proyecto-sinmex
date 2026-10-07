"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AsignarFactura } from "./asignar-factura";

/** Operación → Facturas (T-19): asignar, y buscar y corregir. */
export function PantallaFacturas({ sucursal }: { sucursal: string | null }) {
  const [pestana, setPestana] = useState<"asignar" | "buscar">("asignar");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Facturas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div role="tablist" className="flex gap-2">
          <button
            role="tab"
            aria-selected={pestana === "asignar"}
            onClick={() => setPestana("asignar")}
            className={`rounded-md border px-3 py-1.5 text-sm ${pestana === "asignar" ? "bg-muted font-medium" : ""}`}
          >
            Asignar
          </button>
          <button
            role="tab"
            aria-selected={pestana === "buscar"}
            onClick={() => setPestana("buscar")}
            className={`rounded-md border px-3 py-1.5 text-sm ${pestana === "buscar" ? "bg-muted font-medium" : ""}`}
          >
            Buscar y corregir
          </button>
        </div>
        {pestana === "asignar" ? (
          <AsignarFactura sucursal={sucursal} />
        ) : (
          <p className="text-sm text-muted-foreground">Próximamente.</p>
        )}
      </CardContent>
    </Card>
  );
}

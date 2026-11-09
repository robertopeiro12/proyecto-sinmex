"use client";

import type { ReactNode } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Ventana } from "@/components/ui/ventana";
import type { EstadoDetalle } from "./use-detalle-abierto";

/**
 * La ventana del detalle de un renglón (como las del sistema viejo): "Cargando…", el error o
 * el detalle, con su título ("Cobranza · Ricardo · 09/11/2026"). Se cierra con la ✕, Escape
 * o un clic fuera.
 */
export function VentanaDetalle<D>({
  abierta,
  alCerrar,
  titulo,
  estado,
  children,
}: {
  abierta: boolean;
  alCerrar: () => void;
  titulo: string;
  estado: EstadoDetalle<D>;
  children: (datos: D) => ReactNode;
}) {
  return (
    <Ventana abierta={abierta} alCerrar={alCerrar} titulo={titulo} ancho="detalle">
      {estado.tipo === "cargando" && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {estado.tipo === "error" && <Aviso tono="error">{estado.mensaje}</Aviso>}
      {estado.tipo === "listo" && children(estado.datos)}
    </Ventana>
  );
}

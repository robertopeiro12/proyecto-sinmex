import type { ReactNode } from "react";
import { Aviso } from "@/components/ui/aviso";
import { MarcoDetalle } from "./piezas";
import type { EstadoDetalle } from "./use-detalle-abierto";

/** El renglón que se abre bajo otro: "Cargando…", el error o el detalle. */
export function FilaDetalle<D>({
  columnas,
  estado,
  children,
}: {
  columnas: number;
  estado: EstadoDetalle<D>;
  children: (datos: D) => ReactNode;
}) {
  return (
    <tr>
      <td colSpan={columnas} className="border-b p-0">
        <MarcoDetalle>
          {estado.tipo === "cargando" && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {estado.tipo === "error" && <Aviso tono="error">{estado.mensaje}</Aviso>}
          {estado.tipo === "listo" && children(estado.datos)}
        </MarcoDetalle>
      </td>
    </tr>
  );
}

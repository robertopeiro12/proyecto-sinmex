import type { ReactNode } from "react";
import { ETIQUETA_STATUS, type StatusVenta } from "@/lib/ventas";
import { cn } from "@/lib/utils";

export type TonoEtiqueta = "exito" | "advertencia" | "error" | "informacion" | "neutro";

const CLASE: Record<TonoEtiqueta, string> = {
  exito: "bg-success-soft text-success",
  advertencia: "bg-warning-soft text-warning",
  error: "bg-destructive-soft text-destructive",
  informacion: "bg-info-soft text-info",
  neutro: "bg-muted text-muted-foreground",
};

/** Pastilla redonda con un estado corto (spec §4.5). Sin mayúsculas a propósito. */
export function Etiqueta({
  tono = "neutro",
  children,
  className,
}: {
  tono?: TonoEtiqueta;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-tono={tono}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        CLASE[tono],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Pagada verde, Pendiente ámbar, Abonado gris azulado, Promoción gris, Cuenta perdida rojo. */
export const TONO_STATUS_VENTA: Record<StatusVenta, TonoEtiqueta> = {
  pagada: "exito",
  pendiente: "advertencia",
  abonado: "informacion",
  promocion: "neutro",
  cuenta_perdida: "error",
};

/** El texto sale de `ETIQUETA_STATUS` (lib/ventas.ts), que no cambia. */
export function EtiquetaStatusVenta({ status }: { status: StatusVenta }) {
  return <Etiqueta tono={TONO_STATUS_VENTA[status]}>{ETIQUETA_STATUS[status]}</Etiqueta>;
}

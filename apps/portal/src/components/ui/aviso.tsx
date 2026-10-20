import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type TonoAviso = "error" | "exito" | "advertencia" | "informacion";

const ESTILO: Record<TonoAviso, { clase: string; Icono: typeof CircleAlert }> = {
  error: { clase: "bg-destructive-soft text-destructive", Icono: CircleAlert },
  exito: { clase: "bg-success-soft text-success", Icono: CircleCheck },
  advertencia: { clase: "bg-warning-soft text-warning", Icono: TriangleAlert },
  informacion: { clase: "bg-info-soft text-info", Icono: Info },
};

/**
 * Un mensaje en su color (UI Etapa 1, spec §4.5): verde = salió bien, ámbar = ojo,
 * rojo = error, gris azulado = información. El error interrumpe al lector de
 * pantalla (`alert`); los demás esperan su turno (`status`).
 */
export function Aviso({ tono, children, className }: { tono: TonoAviso; children: ReactNode; className?: string }) {
  const { clase, Icono } = ESTILO[tono];
  return (
    <div
      role={tono === "error" ? "alert" : "status"}
      data-tono={tono}
      className={cn("flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm", clase, className)}
    >
      <Icono aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

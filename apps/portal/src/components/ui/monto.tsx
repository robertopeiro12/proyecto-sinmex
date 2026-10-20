import { formatearPesos } from "@/lib/formato";
import { cn } from "@/lib/utils";

/** Pesos desde centavos, con cifras de ancho fijo; un negativo va en rojo (spec §4.5). */
export function Monto({ centavos, className }: { centavos: number; className?: string }) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", centavos < 0 && "text-destructive", className)}>
      {formatearPesos(centavos)}
    </span>
  );
}

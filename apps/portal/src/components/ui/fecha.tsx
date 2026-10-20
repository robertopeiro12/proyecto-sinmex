import { formatearFecha, formatearFechaHora } from "@/lib/formato";

/** `dd/mm/aaaa` (o `dd/mm/aaaa hh:mm` con `conHora`); el valor original queda en `dateTime`. */
export function Fecha({ valor, conHora = false }: { valor: string; conHora?: boolean }) {
  return (
    <time dateTime={valor} className="tabular-nums whitespace-nowrap">
      {conHora ? formatearFechaHora(valor) : formatearFecha(valor)}
    </time>
  );
}

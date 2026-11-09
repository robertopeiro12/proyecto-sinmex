import type { ReactNode } from "react";
import { Etiqueta } from "@/components/ui/etiqueta";
import { Monto } from "@/components/ui/monto";
import { Td } from "@/components/ui/tabla";
import { etiquetaLiquidada, type MetodoPago, type NotaDetalle, type PagoDetalle } from "@/lib/flujo-diario";
import { formatearPesos } from "@/lib/formato";

/*
 * Piezas chicas que comparten el detalle por vendedor (Flujo diario y Dashboard) y el
 * detalle por día. Todo lo que se ve sale de components/ui/; aquí solo se arma.
 */

/** Barrita proporcional: `valor` contra el `maximo` de su lista. */
export function Barra({ valor, maximo, className }: { valor: number; maximo: number; className?: string }) {
  const ancho = maximo > 0 ? Math.max(0, Math.min(100, Math.round((valor / maximo) * 100))) : 0;
  return (
    <div aria-hidden className={`h-[5px] rounded-full bg-accent ${className ?? ""}`}>
      <div className="h-[5px] rounded-full bg-sucursal" style={{ width: `${ancho}%` }} />
    </div>
  );
}

/** "Abarrotes Mary" · Liquidada: "Sí" o "Abonado" + "resta $X" (el saldo que dejó ESE pago). */
export function TdLiquidada({ pago }: { pago: PagoDetalle }) {
  const { texto, resta } = etiquetaLiquidada(pago);
  return (
    <Td className="whitespace-nowrap">
      <Etiqueta tono={texto === "Sí" ? "exito" : "informacion"}>{texto}</Etiqueta>
      {resta && <span className="ml-1.5 text-xs text-muted-foreground">{`resta ${resta}`}</span>}
    </Td>
  );
}

const TEXTO_METODO: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
};

/** El importe del pago; si no fue en efectivo, su método al lado para que se distinga. */
export function TdImporte({ pago }: { pago: PagoDetalle }) {
  return (
    <Td alinear="derecha" className="whitespace-nowrap">
      {pago.metodo !== "efectivo" && (
        <Etiqueta tono="neutro" className="mr-1.5">
          {TEXTO_METODO[pago.metodo]}
        </Etiqueta>
      )}
      <Monto centavos={pago.montoCentavos} />
    </Td>
  );
}

/** "Sí" (verde) o "No" (gris) en Visitas. */
export function EtiquetaVendio({ vendio }: { vendio: boolean }) {
  return <Etiqueta tono={vendio ? "exito" : "neutro"}>{vendio ? "Sí" : "No"}</Etiqueta>;
}

const HORA_TIJUANA = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Tijuana",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ISO (UTC) → `h:mm` en hora de Tijuana ("8:42"); sin hora, "—". */
export function horaTijuana(iso: string | null): string {
  if (!iso) return "—";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";
  const partes = HORA_TIJUANA.formatToParts(fecha);
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minuto = partes.find((p) => p.type === "minute")?.value ?? "00";
  return `${hora}:${minuto}`;
}

/** El título de un bloque del detalle: "Cobranza  $2,796.50". */
export function TituloBloque({ children, extra, tenue = false }: { children: ReactNode; extra?: ReactNode; tenue?: boolean }) {
  return (
    <h3
      className={`mb-2 flex items-baseline justify-between gap-3 text-[13.5px] ${tenue ? "font-medium text-muted-foreground" : "font-semibold"}`}
    >
      <span>{children}</span>
      {extra && <span className="text-[12.5px] font-normal text-muted-foreground">{extra}</span>}
    </h3>
  );
}

/** Un texto de "no hay nada" dentro de una pestaña del detalle. */
export function SinDatos({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** El contenedor del detalle abierto bajo un renglón: raya del color de la sucursal a la izquierda. */
export function MarcoDetalle({ children }: { children: ReactNode }) {
  return <div className="border-l-[3px] border-sucursal bg-card px-[18px] pt-4 pb-5 whitespace-normal">{children}</div>;
}

/** Suma de centavos. */
export const sumar = <T,>(filas: T[], valor: (f: T) => number): number => filas.reduce((s, f) => s + valor(f), 0);

/** Piezas con separador de miles. */
export const formatearPiezas = (n: number): string => n.toLocaleString("en-US");

/** "Horchata 500 ml × 20 a $11.50 · Jamaica 500 ml × 20 a $11.50". */
export function textoLineas(nota: NotaDetalle): string {
  return nota.lineas.map((l) => `${l.producto} × ${l.cantidad} a ${formatearPesos(l.precioCentavos)}`).join(" · ");
}

/** "▸ TJ261109RB07": abre la nota a sus productos. */
export function BotonFolio({ folio, abierta, onClick }: { folio: string; abierta: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={abierta}
      onClick={onClick}
      className="rounded font-mono text-[12.5px] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sucursal"
    >
      <span aria-hidden className="mr-1 inline-block w-2.5 text-muted-foreground">
        {abierta ? "▾" : "▸"}
      </span>
      {folio}
    </button>
  );
}

/** El renglón de los productos de una nota abierta. */
export function FilaLineas({ columnas, texto }: { columnas: number; texto: string }) {
  return (
    <tr>
      <td colSpan={columnas} className="border-b bg-menu py-1.5 pr-3 pl-8 text-[12.5px] text-muted-foreground">
        {texto || "Sin productos."}
      </td>
    </tr>
  );
}

/** Un número del renglón que abre su pestaña del detalle; en cero no se pica (no hay nada que ver). */
export function BotonNumero({
  children,
  cero,
  etiqueta,
  onClick,
}: {
  children: ReactNode;
  cero: boolean;
  etiqueta: string;
  onClick: () => void;
}) {
  if (cero) return <span className="text-muted-foreground">{children}</span>;
  return (
    <button
      type="button"
      aria-label={etiqueta}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex items-center rounded-md border bg-card px-[7px] py-0.5 font-semibold outline-none transition-colors hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-sucursal"
    >
      {children}
    </button>
  );
}

/** "Ver": abre una pestaña del detalle. */
export function BotonVer({ etiqueta, onClick }: { etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded text-[12.5px] underline decoration-border underline-offset-[3px] outline-none hover:decoration-muted-foreground focus-visible:ring-2 focus-visible:ring-sucursal"
    >
      Ver
    </button>
  );
}

/** El nombre (o la fecha) que abre y cierra el renglón: "▸ Ricardo". */
export function BotonRenglon({
  abierto,
  children,
  onClick,
}: {
  abierto: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={abierto}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex items-baseline gap-1 rounded text-left font-semibold outline-none focus-visible:ring-2 focus-visible:ring-sucursal"
    >
      <span aria-hidden className="inline-block w-2.5 shrink-0 text-muted-foreground">
        {abierto ? "▾" : "▸"}
      </span>
      {children}
    </button>
  );
}

/** "Pronto" en gris (Inventario). */
export function Pronto() {
  return <span className="text-muted-foreground">Pronto</span>;
}

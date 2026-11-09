import type { ReactNode } from "react";
import { Monto } from "@/components/ui/monto";
import type { Totales } from "@/lib/flujo-diario";
import { formatearPiezas } from "./piezas";

/**
 * La fila de cifras de arriba (spec §5.2 y §5.3): Venta general, Monto, Cobranza, Gasto,
 * Tesorería (en el color de la sucursal) y una última que cambia por pantalla: Visitas en
 * el Flujo diario, Vendedores en el Dashboard.
 */
export function ResumenCifras({
  totales,
  ultima,
  detalleCobranza,
}: {
  totales: Totales;
  ultima: { titulo: string; valor: string; detalle?: string };
  /** Una línea bajo la Cobranza que dice de quién es (Flujo diario: vendedores / oficina). */
  detalleCobranza?: string;
}) {
  return (
    <dl className="grid grid-cols-3 overflow-hidden rounded-[10px] border xl:grid-cols-6">
      <Cifra titulo="Venta general">{`${formatearPiezas(totales.piezas)} pzs`}</Cifra>
      <Cifra titulo="Monto">
        <Monto centavos={totales.montoCentavos} />
      </Cifra>
      <Cifra titulo="Cobranza" detalle={detalleCobranza}>
        <Monto centavos={totales.cobranzaCentavos} />
      </Cifra>
      <Cifra titulo="Gasto">
        <Monto centavos={totales.gastoCentavos} />
      </Cifra>
      <Cifra titulo="Tesorería" resaltada>
        <Monto centavos={totales.tesoreriaCentavos} />
      </Cifra>
      <Cifra titulo={ultima.titulo} detalle={ultima.detalle}>
        {ultima.valor}
      </Cifra>
    </dl>
  );
}

function Cifra({
  titulo,
  detalle,
  resaltada = false,
  children,
}: {
  titulo: string;
  detalle?: string;
  resaltada?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="-mb-px border-r border-b px-3.5 py-3 last:border-r-0 xl:mb-0 xl:border-b-0 [&:nth-child(3)]:border-r-0 xl:[&:nth-child(3)]:border-r">
      <dt className="mb-0.5 text-xs text-muted-foreground">{titulo}</dt>
      <dd className={`text-lg font-bold tabular-nums ${resaltada ? "text-sucursal" : ""}`}>{children}</dd>
      {detalle && <dd className="mt-0.5 text-xs text-muted-foreground">{detalle}</dd>}
    </div>
  );
}

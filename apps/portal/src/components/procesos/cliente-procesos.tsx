"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { Aviso } from "@/components/ui/aviso";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { mensajeDe } from "@/lib/api";
import type { ClienteResumen } from "@/lib/clientes";
import { formatearDiaCorto, formatearPesos, plural } from "@/lib/formato";
import { resumenCliente, type ResumenCliente } from "@/lib/procesos";

/** "N promociones" en azul; el globito (Tooltip de base-ui) lista cada una. */
function Promociones({ promociones }: { promociones: string[] }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={150}
        className="rounded font-semibold text-sucursal outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sucursal"
      >
        {plural(promociones.length, "promoción", "promociones")}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" sideOffset={6} className="z-50">
          <Tooltip.Popup className="max-w-[22rem] rounded-[7px] bg-foreground px-3 py-2 text-xs leading-snug text-background shadow-[0_8px_24px_rgb(0_0_0/0.18)] transition-[opacity,scale] duration-150 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <ul className="flex flex-col gap-1">
              {promociones.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Los datos del cliente elegido en UNA línea de texto gris (boceto 2): [Prospecto ·] Contado /
 * Crédito N días · Debe $X en N notas (solo si debe) · A favor $X (solo si tiene) · Última compra
 * mar 24 nov · N promociones.
 * Lo que no hay (sin deuda, sin compras, sin promociones) no se menciona.
 */
export function LineaCliente({ resumen }: { resumen: ResumenCliente }) {
  const partes: ReactNode[] = [];
  if (resumen.tipo === "prospecto") partes.push("Prospecto");
  partes.push(resumen.diasCredito && resumen.diasCredito > 0 ? `Crédito ${resumen.diasCredito} días` : "Contado");
  if (resumen.deudaCentavos > 0) {
    partes.push(
      <>
        <span className="font-semibold text-warning">{`Debe ${formatearPesos(resumen.deudaCentavos)}`}</span>
        {` en ${plural(resumen.notasConSaldo, "nota", "notas")}`}
      </>,
    );
  }
  if (resumen.saldoFavorCentavos > 0) partes.push(`A favor ${formatearPesos(resumen.saldoFavorCentavos)}`);
  if (resumen.ultimaCompra) partes.push(`Última compra ${formatearDiaCorto(resumen.ultimaCompra)}`);
  if (resumen.promociones.length > 0) partes.push(<Promociones promociones={resumen.promociones} />);
  return (
    <p className="text-sm text-muted-foreground">
      {partes.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="mx-0.5">{" · "}</span>}
          {p}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * El cliente de Procesos (D0): el buscador como campo (el nombre elegido con ✕ para quitarlo)
 * y, debajo, sus datos en una línea. Quien la usa decide si deja cambiar de cliente.
 */
export function ClienteProcesos({
  clientes,
  cliente,
  version = 0,
  onElegir,
  onQuitar,
}: {
  clientes: ClienteResumen[];
  cliente: ClienteResumen | null;
  /** Al subir, los datos se vuelven a pedir (una venta o un cobro cambian la deuda). */
  version?: number;
  onElegir: (c: ClienteResumen) => void;
  onQuitar: () => void;
}) {
  const [resumen, setResumen] = useState<ResumenCliente | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Otro cliente limpia la línea; otra `version` del mismo la deja hasta que llegue la nueva.
  useEffect(() => {
    setResumen(null);
  }, [cliente]);

  useEffect(() => {
    setError(null);
    if (!cliente) return;
    let vigente = true;
    resumenCliente(cliente.id).then(
      (r) => vigente && setResumen(r),
      (err: unknown) => vigente && setError(mensajeDe(err, "No se pudieron cargar los datos del cliente.")),
    );
    return () => {
      vigente = false;
    };
  }, [cliente, version]);

  return (
    <div className="flex flex-col gap-2">
      <BuscadorCliente
        variante="campo"
        className="w-[28rem] max-w-full"
        clientes={clientes}
        cliente={cliente}
        onElegir={onElegir}
        onQuitar={onQuitar}
        etiquetaQuitar="Quitar cliente"
      />
      {cliente && resumen && resumen.id === cliente.id && <LineaCliente resumen={resumen} />}
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}

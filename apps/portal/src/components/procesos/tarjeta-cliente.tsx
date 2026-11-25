"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Etiqueta, type TonoEtiqueta } from "@/components/ui/etiqueta";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { mensajeDe } from "@/lib/api";
import type { ClienteResumen } from "@/lib/clientes";
import { formatearDiaLargo, formatearPesos } from "@/lib/formato";
import { resumenCliente, type ResumenCliente } from "@/lib/procesos";

function Pastilla({ tono = "neutro", etiqueta, children }: { tono?: TonoEtiqueta; etiqueta?: string; children: ReactNode }) {
  return (
    <Etiqueta tono={tono} className="px-3 py-1 text-[13px] font-normal whitespace-normal">
      {/* Un solo hijo: la Etiqueta es inline-flex y entre hijos flex se pierden los espacios. */}
      <span>
        {etiqueta && (
          <>
            <span>{etiqueta}</span>{" "}
          </>
        )}
        {children}
      </span>
    </Etiqueta>
  );
}

/** Las pastillas del cliente elegido (D0): tipo de negocio, crédito, deuda, última compra y promociones. */
export function PastillasCliente({ resumen }: { resumen: ResumenCliente }) {
  const tipo = resumen.tipo === "prospecto" ? "Prospecto" : "Cliente";
  const notas = resumen.notasConSaldo === 1 ? "nota" : "notas";
  return (
    <div className="flex min-w-0 flex-1 flex-wrap content-start gap-2">
      <Pastilla etiqueta={resumen.tipoNegocio ? `${tipo} ·` : undefined}>
        <b className="font-semibold">{resumen.tipoNegocio ?? tipo}</b>
      </Pastilla>
      {resumen.diasCredito && resumen.diasCredito > 0 ? (
        <Pastilla etiqueta="Crédito">
          <b className="font-semibold">{resumen.diasCredito} días</b>
        </Pastilla>
      ) : (
        <Pastilla>Contado</Pastilla>
      )}
      {resumen.deudaCentavos > 0 ? (
        <Pastilla tono="advertencia" etiqueta="Debe">
          <b className="font-semibold">{formatearPesos(resumen.deudaCentavos)}</b> en {resumen.notasConSaldo} {notas}
        </Pastilla>
      ) : (
        <Pastilla>Sin deuda</Pastilla>
      )}
      {resumen.ultimaCompra ? (
        <Pastilla etiqueta="Última compra">
          <b className="font-semibold">{formatearDiaLargo(resumen.ultimaCompra)}</b>
        </Pastilla>
      ) : (
        <Pastilla>Sin compras</Pastilla>
      )}
      {resumen.promociones.map((p) => (
        <Pastilla key={p} etiqueta="Promoción">
          <b className="font-semibold">{p}</b>
        </Pastilla>
      ))}
    </div>
  );
}

/**
 * "Seleccionar cliente", como el viejo (D0): el buscador de clientes de la sucursal y, con
 * uno elegido, sus datos en pastillas. Quien la usa decide si deja cambiar de cliente.
 */
export function TarjetaCliente({
  clientes,
  cliente,
  onElegir,
  onQuitar,
}: {
  clientes: ClienteResumen[];
  cliente: ClienteResumen | null;
  onElegir: (c: ClienteResumen) => void;
  onQuitar: () => void;
}) {
  const [resumen, setResumen] = useState<ResumenCliente | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResumen(null);
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
  }, [cliente]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start gap-4">
        <BuscadorCliente clientes={clientes} cliente={cliente} onElegir={onElegir} onQuitar={onQuitar} />
        {cliente && resumen && resumen.id === cliente.id && (
          <div className="min-w-0 flex-1 pt-6">
            <PastillasCliente resumen={resumen} />
          </div>
        )}
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}

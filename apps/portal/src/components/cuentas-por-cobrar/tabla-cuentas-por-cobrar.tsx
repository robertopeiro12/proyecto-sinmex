"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { enlaceCobrar, textoVence, type ClienteConDeuda } from "@/lib/cuentas-por-cobrar";
import { formatearFecha } from "@/lib/reportes";
import { ETIQUETA_STATUS, formatearPesos } from "@/lib/ventas";

/** Una fila por cliente; el botón del nombre abre o cierra sus notas. */
export function TablaCuentasPorCobrar({
  clientes,
  sucursal,
  puedeCobrar,
}: {
  clientes: ClienteConDeuda[];
  sucursal: string | null;
  puedeCobrar: boolean;
}) {
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set());

  function alternar(id: string) {
    setAbiertos((antes) => {
      const despues = new Set(antes);
      if (despues.has(id)) despues.delete(id);
      else despues.add(id);
      return despues;
    });
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left">
          <th className="py-1.5">Cliente</th>
          <th className="py-1.5 text-right">Notas</th>
          <th className="py-1.5 text-right">Saldo</th>
          <th className="py-1.5 text-right">Vencido</th>
        </tr>
      </thead>
      <tbody>
        {clientes.map((c) => {
          const abierto = abiertos.has(c.clienteId);
          return (
            <Fragment key={c.clienteId}>
              <tr className="border-t">
                <td className="py-1.5">
                  <button
                    type="button"
                    aria-expanded={abierto}
                    onClick={() => alternar(c.clienteId)}
                    className="text-left font-medium hover:underline"
                  >
                    <span aria-hidden="true">{abierto ? "▾" : "▸"}</span> {c.cliente}
                    {c.clienteDadoDeBaja ? " (dado de baja)" : ""} · {c.sucursalCodigo}
                  </button>
                </td>
                <td className="py-1.5 text-right">{c.notas.length}</td>
                <td className="py-1.5 text-right font-semibold">{formatearPesos(c.saldoCentavos)}</td>
                <td className={`py-1.5 text-right ${c.vencidoCentavos > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                  {formatearPesos(c.vencidoCentavos)}
                </td>
              </tr>
              {abierto && (
                <tr>
                  <td colSpan={4} className="pb-3 pl-6">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1">Fecha</th>
                          <th className="py-1">Folio</th>
                          <th className="py-1"># nota</th>
                          <th className="py-1 text-right">Total</th>
                          <th className="py-1 text-right">Abonado</th>
                          <th className="py-1 text-right">Saldo</th>
                          <th className="py-1 pl-4">Status</th>
                          <th className="py-1 pl-4">Vence</th>
                          {puedeCobrar && !c.clienteDadoDeBaja && <th className="py-1" />}
                        </tr>
                      </thead>
                      <tbody>
                        {c.notas.map((n) => (
                          <tr key={n.id} className="border-t">
                            <td className="py-1">{formatearFecha(n.fecha)}</td>
                            <td className="py-1 font-mono">{n.folio}</td>
                            <td className="py-1">{n.numNota ?? "—"}</td>
                            <td className="py-1 text-right">{formatearPesos(n.montoCentavos)}</td>
                            <td className="py-1 text-right">{formatearPesos(n.abonadoCentavos)}</td>
                            <td className="py-1 text-right font-semibold">{formatearPesos(n.saldoCentavos)}</td>
                            <td className="py-1 pl-4">{ETIQUETA_STATUS[n.status]}</td>
                            <td className={`py-1 pl-4 ${n.diasAtraso > 0 ? "text-destructive" : ""}`}>{textoVence(n)}</td>
                            {puedeCobrar && !c.clienteDadoDeBaja && (
                              <td className="py-1 text-right">
                                <Link
                                  href={enlaceCobrar(c.clienteId, n.id, sucursal)}
                                  aria-label={`Cobrar ${n.folio}`}
                                  className={buttonVariants({ size: "sm" })}
                                >
                                  Cobrar
                                </Link>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

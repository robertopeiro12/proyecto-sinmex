"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, Fila, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { enlaceCobrar, textoVence, type ClienteConDeuda } from "@/lib/cuentas-por-cobrar";
import { ETIQUETA_STATUS } from "@/lib/ventas";

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
    <CajaTabla>
      <Tabla>
        <thead>
          <tr>
            <Th>Cliente</Th>
            <Th alinear="derecha">Notas</Th>
            <Th alinear="derecha">Saldo</Th>
            <Th alinear="derecha">Vencido</Th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => {
            const abierto = abiertos.has(c.clienteId);
            return (
              <Fragment key={c.clienteId}>
                <Fila interactiva onClick={() => alternar(c.clienteId)}>
                  <Td>
                    {/* La fila entera se puede picar; el botón es la vía del teclado y del lector de pantalla. */}
                    <button
                      type="button"
                      aria-expanded={abierto}
                      onClick={(e) => {
                        e.stopPropagation();
                        alternar(c.clienteId);
                      }}
                      className="text-left font-medium hover:underline"
                    >
                      <span aria-hidden="true">{abierto ? "▾" : "▸"}</span> {c.cliente}
                      {c.clienteDadoDeBaja ? " (dado de baja)" : ""} · {c.sucursalCodigo}
                    </button>
                  </Td>
                  <Td alinear="derecha">{c.notas.length}</Td>
                  <TdMonto centavos={c.saldoCentavos} className="font-semibold" />
                  <TdMonto
                    centavos={c.vencidoCentavos}
                    className={c.vencidoCentavos > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}
                  />
                </Fila>
                {abierto && (
                  <tr>
                    <td colSpan={4} className="border-b bg-menu/40 py-2 pr-3 pl-6">
                      <CajaTabla className="bg-background">
                        <Tabla densidad="compacta">
                          <thead>
                            <tr>
                              <Th>Fecha</Th>
                              <Th>Folio</Th>
                              <Th># nota</Th>
                              <Th alinear="derecha">Total</Th>
                              <Th alinear="derecha">Abonado</Th>
                              <Th alinear="derecha">Saldo</Th>
                              <Th>Status</Th>
                              <Th>Vence</Th>
                              {puedeCobrar && !c.clienteDadoDeBaja && <Th />}
                            </tr>
                          </thead>
                          <tbody>
                            {c.notas.map((n) => (
                              <tr key={n.id}>
                                <Td>
                                  <Fecha valor={n.fecha} />
                                </Td>
                                <Td className="font-mono">{n.folio}</Td>
                                <Td>{n.numNota ?? "—"}</Td>
                                <TdMonto centavos={n.montoCentavos} />
                                <TdMonto centavos={n.abonadoCentavos} />
                                <TdMonto centavos={n.saldoCentavos} className="font-semibold" />
                                <Td>{ETIQUETA_STATUS[n.status]}</Td>
                                <Td className={n.diasAtraso > 0 ? "text-destructive" : ""}>{textoVence(n)}</Td>
                                {puedeCobrar && !c.clienteDadoDeBaja && (
                                  <Td alinear="derecha">
                                    <Link
                                      href={enlaceCobrar(c.clienteId, n.id, sucursal)}
                                      aria-label={`Cobrar ${n.folio}`}
                                      className={buttonVariants({ size: "sm" })}
                                    >
                                      Cobrar
                                    </Link>
                                  </Td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </Tabla>
                      </CajaTabla>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

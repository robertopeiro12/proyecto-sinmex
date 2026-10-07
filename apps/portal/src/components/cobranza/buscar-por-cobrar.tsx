"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import { buscarPorCobrar, type NotaPorCobrar } from "@/lib/cobranzas";
import { ETIQUETA_STATUS, formatearPesos, hoyEnTijuana } from "@/lib/ventas";

/**
 * §3.1: buscar la cuenta por cobrar. Por cliente se entra directo; por fecha de
 * la venta o por # de nota sale una tabla de notas por cobrar de cualquier
 * cliente del alcance, y un clic entra a su cliente con esa nota ya marcada.
 */
export function BuscarPorCobrar({
  sucursal,
  onElegir,
}: {
  sucursal: string | null;
  onElegir: (clienteId: string, notaId: string | null) => void;
}) {
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [fecha, setFecha] = useState(hoyEnTijuana);
  const [numNota, setNumNota] = useState("");
  const [notas, setNotas] = useState<NotaPorCobrar[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => {
        if (vigente) setClientes(lista);
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar los clientes.");
      });
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  async function buscar(filtro: { fecha: string } | { numNota: string }) {
    setBuscando(true);
    setError(null);
    try {
      setNotas(await buscarPorCobrar(filtro, sucursal));
    } catch (err) {
      setNotas(null);
      setError(mensajeDe(err, "No se pudieron buscar las notas por cobrar."));
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <BuscadorCliente clientes={clientes} cliente={null} onElegir={(c) => onElegir(c.id, null)} onQuitar={() => {}} />

      <div className="flex flex-wrap items-end gap-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void buscar({ fecha });
          }}
          className="flex items-end gap-2"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cobranza-fecha" className="text-sm font-medium">
              Fecha de la venta
            </label>
            <input
              id="cobranza-fecha"
              type="date"
              required
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" variant="outline" disabled={buscando}>
            Buscar por fecha
          </Button>
        </form>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (numNota.trim() !== "") void buscar({ numNota });
          }}
          className="flex items-end gap-2"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cobranza-num-nota" className="text-sm font-medium">
              # de nota
            </label>
            <input
              id="cobranza-num-nota"
              maxLength={30}
              value={numNota}
              onChange={(e) => setNumNota(e.target.value)}
              className="w-40 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" variant="outline" disabled={buscando || numNota.trim() === ""}>
            Buscar por # de nota
          </Button>
        </form>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {notas !== null &&
        (notas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay notas por cobrar con esa búsqueda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-1.5">Cliente</th>
                <th className="py-1.5">Fecha</th>
                <th className="py-1.5">Folio</th>
                <th className="py-1.5"># de nota</th>
                <th className="py-1.5 text-right">Total</th>
                <th className="py-1.5 text-right">Saldo</th>
                <th className="py-1.5">Status</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {notas.map((n) => (
                <tr key={n.id} className="border-t">
                  <td className="py-1.5">
                    {n.cliente} · {n.sucursalCodigo}
                  </td>
                  <td className="py-1.5">{n.fecha}</td>
                  <td className="py-1.5 font-mono">{n.folio}</td>
                  <td className="py-1.5">{n.numNota ?? "—"}</td>
                  <td className="py-1.5 text-right">{formatearPesos(n.montoCentavos)}</td>
                  <td className="py-1.5 text-right font-semibold">{formatearPesos(n.saldoCentavos)}</td>
                  <td className="py-1.5">{ETIQUETA_STATUS[n.status]}</td>
                  <td className="py-1.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      aria-label={`Cobrar ${n.folio}`}
                      onClick={() => onElegir(n.clienteId, n.id)}
                    >
                      Cobrar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}

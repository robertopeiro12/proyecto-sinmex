"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ErrorApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  LARGO_MAX_NUMERO_FACTURA,
  asignarFactura,
  listarPorFacturar,
  totalSeleccionado,
  type VentaPorFacturar,
} from "@/lib/facturas";
import { ETIQUETA_STATUS, formatearPesos } from "@/lib/ventas";

/**
 * Asignar factura a notas de ventas (T-19, §5.1 del spec): cliente → marcar
 * ventas → teclear el número del SAT. El servidor decide si se puede; aquí solo
 * se arma la selección.
 */
export function AsignarFactura({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [incluirNA, setIncluirNA] = useState(false);
  const [ventas, setVentas] = useState<VentaPorFacturar[]>([]);
  const [cargada, setCargada] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [numero, setNumero] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo asignar la factura.");

  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => vigente && setClientes(lista))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  useEffect(() => {
    if (!cliente) return;
    let vigente = true;
    setCargada(false);
    setErrorCarga(null);
    listarPorFacturar(cliente.id, incluirNA)
      .then((lista) => {
        if (!vigente) return;
        setVentas(lista);
        setSeleccion(new Set());
        setCargada(true);
      })
      .catch((err) => {
        if (!vigente) return;
        // Un fallo de carga no es "sin ventas": se limpia la lista y se avisa.
        setVentas([]);
        setSeleccion(new Set());
        setErrorCarga(
          err instanceof ErrorApi && err.mensajeApi
            ? err.mensajeApi
            : "No se pudo cargar la lista de ventas por facturar.",
        );
        setCargada(true);
      });
    return () => {
      vigente = false;
    };
  }, [cliente, incluirNA, recarga]);

  if (!puede("venta.asignar_factura")) {
    return <p className="text-sm text-muted-foreground">No tienes permiso para asignar facturas.</p>;
  }

  const total = totalSeleccionado(ventas, seleccion);
  const todas = ventas.length > 0 && seleccion.size === ventas.length;

  function alternar(id: string) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!cliente) return;
    const ids = ventas.filter((v) => seleccion.has(v.id)).map((v) => v.id);
    await enviar(
      async () => {
        const factura = await asignarFactura(cliente.id, numero.trim(), ids);
        setAviso(
          `Factura ${factura.numero} asignada a ${ids.length} ${ids.length === 1 ? "venta" : "ventas"} (${formatearPesos(total)})`,
        );
        setNumero("");
        setRecarga((n) => n + 1);
      },
      () => {},
    );
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <BuscadorCliente
        clientes={clientes}
        cliente={cliente}
        onElegir={(c) => {
          setCliente(c);
          setAviso(null);
        }}
        onQuitar={() => {
          setCliente(null);
          setVentas([]);
          setSeleccion(new Set());
        }}
        disabled={enviando}
      />

      {aviso && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {aviso}
        </p>
      )}

      {cliente && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={incluirNA}
              onChange={(e) => setIncluirNA(e.target.checked)}
              disabled={enviando}
            />
            Mostrar también las N/A
          </label>

          {errorCarga ? (
            <p role="alert" className="text-sm text-destructive">
              {errorCarga}
            </p>
          ) : cargada && ventas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este cliente no tiene ventas por facturar.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-1.5">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todas"
                      checked={todas}
                      onChange={() => setSeleccion(todas ? new Set() : new Set(ventas.map((v) => v.id)))}
                      disabled={enviando}
                    />
                  </th>
                  <th className="py-1.5">Fecha</th>
                  <th className="py-1.5">Folio</th>
                  <th className="py-1.5"># de nota</th>
                  <th className="py-1.5 text-right">Monto</th>
                  <th className="py-1.5">Status</th>
                  <th className="py-1.5">Factura</th>
                </tr>
              </thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Marcar ${v.folio}`}
                        checked={seleccion.has(v.id)}
                        onChange={() => alternar(v.id)}
                        disabled={enviando}
                      />
                    </td>
                    <td className="py-1.5">{v.fecha}</td>
                    <td className="py-1.5 font-mono">{v.folio}</td>
                    <td className="py-1.5">{v.numNota ?? "—"}</td>
                    <td className="py-1.5 text-right">{formatearPesos(v.montoCentavos)}</td>
                    <td className="py-1.5">{ETIQUETA_STATUS[v.status]}</td>
                    <td className="py-1.5">{v.factura}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="text-right text-base font-semibold">Total marcado: {formatearPesos(total)}</p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="numero-factura" className="text-sm font-medium">
                Número de factura
              </label>
              <input
                id="numero-factura"
                maxLength={LARGO_MAX_NUMERO_FACTURA}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                disabled={enviando}
                className="w-48 rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <Button type="submit" disabled={enviando || seleccion.size === 0 || numero.trim() === ""}>
              {enviando ? "Asignando…" : "Asignar"}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

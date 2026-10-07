"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  LARGO_MAX_NUMERO_FACTURA,
  buscarFacturas,
  quitarDeFactura,
  renombrarFactura,
  type FacturaConVentas,
} from "@/lib/facturas";
import { formatearPesos } from "@/lib/ventas";

/** Buscar facturas por número o cliente, cambiar su número o quitarle ventas (T-19, §5.2). */
export function BuscarFacturas({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [numero, setNumero] = useState("");
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [facturas, setFacturas] = useState<FacturaConVentas[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Cada búsqueda lleva un número: si responde una vieja después de una nueva, se ignora.
  const busqueda = useRef(0);
  // Cambia con cada resultado nuevo: las tarjetas se remontan y no arrastran errores ni marcas viejas.
  const [generacion, setGeneracion] = useState(0);
  const permitido = puede("venta.asignar_factura");

  useEffect(() => {
    if (!permitido) return;
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => vigente && setClientes(lista))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [sucursal, permitido]);

  if (!permitido) {
    return <p className="text-sm text-muted-foreground">No tienes permiso para asignar facturas.</p>;
  }

  async function alBuscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    if (numero.trim() === "" && !cliente) {
      setError("Escribe un número de factura o elige un cliente.");
      return;
    }
    const mia = ++busqueda.current;
    try {
      const encontradas = await buscarFacturas({
        numero: numero.trim() || undefined,
        clienteId: cliente?.id,
        sucursal,
      });
      if (mia === busqueda.current) {
        setFacturas(encontradas);
        setGeneracion((n) => n + 1);
      }
    } catch (err) {
      if (mia === busqueda.current) setError(mensajeDe(err, "No se pudieron buscar las facturas."));
    }
  }

  function reemplazar(id: string, nueva: FacturaConVentas | null) {
    setFacturas((actual) =>
      (actual ?? []).flatMap((f) => (f.id !== id ? [f] : nueva ? [nueva] : [])),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={alBuscar} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="buscar-numero-factura" className="text-sm font-medium">
            Número de factura a buscar
          </label>
          <input
            id="buscar-numero-factura"
            maxLength={LARGO_MAX_NUMERO_FACTURA}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            className="w-48 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <BuscadorCliente
          clientes={clientes}
          cliente={cliente}
          onElegir={setCliente}
          onQuitar={() => setCliente(null)}
          etiquetaQuitar="Quitar"
        />
        <Button type="submit">Buscar</Button>
      </form>

      {aviso && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {aviso}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Tras borrar la ultima, el aviso ya explica por que no hay ninguna. */}
      {facturas !== null && facturas.length === 0 && !aviso && (
        <p className="text-sm text-muted-foreground">No se encontraron facturas.</p>
      )}

      {(facturas ?? []).map((f) => (
        <TarjetaFactura
          key={`${generacion}-${f.id}`}
          alActuar={() => setAviso(null)}
          factura={f}
          onCambiada={(nueva) => reemplazar(f.id, nueva)}
          onBorrada={() => {
            reemplazar(f.id, null);
            setAviso(`La factura ${f.numero} se borró: ya no tenía ventas.`);
          }}
        />
      ))}
    </div>
  );
}

function TarjetaFactura({
  factura,
  onCambiada,
  onBorrada,
  alActuar,
}: {
  factura: FacturaConVentas;
  onCambiada: (f: FacturaConVentas) => void;
  onBorrada: () => void;
  /** Avisa al padre que se hizo algo en esta tarjeta (limpia el aviso de arriba). */
  alActuar: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [nuevoNumero, setNuevoNumero] = useState(factura.numero);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const titulo = `Factura ${factura.numero}`;

  async function guardarNumero() {
    setError(null);
    alActuar();
    setEnviando(true);
    try {
      const nueva = await renombrarFactura(factura.id, nuevoNumero.trim());
      onCambiada(nueva);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo cambiar el número."));
    } finally {
      setEnviando(false);
    }
  }

  async function quitar() {
    const todas = marcadas.size === factura.ventas.length;
    const pregunta = todas
      ? `¿Quitar todas las ventas? Regresan a "pendiente" y la factura ${factura.numero} desaparece.`
      : `¿Quitar ${marcadas.size} ${marcadas.size === 1 ? "venta" : "ventas"} de la factura ${factura.numero}? Regresan a "pendiente".`;
    if (!window.confirm(pregunta)) return;
    setError(null);
    alActuar();
    setEnviando(true);
    try {
      const { factura: nueva } = await quitarDeFactura(factura.id, [...marcadas]);
      setMarcadas(new Set());
      if (nueva) onCambiada(nueva);
      else onBorrada();
    } catch (err) {
      setError(mensajeDe(err, "No se pudieron quitar las ventas."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section aria-label={titulo} className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{titulo}</h3>
        <p className="text-sm text-muted-foreground">
          {factura.cliente} · {factura.sucursalCodigo} · registró {factura.creadoPor} el {factura.creadoEn}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`renombrar-${factura.id}`} className="text-sm font-medium">
            Nuevo número de {factura.numero}
          </label>
          <input
            id={`renombrar-${factura.id}`}
            maxLength={LARGO_MAX_NUMERO_FACTURA}
            value={nuevoNumero}
            onChange={(e) => setNuevoNumero(e.target.value)}
            disabled={enviando}
            className="w-48 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <Button
          variant="outline"
          onClick={guardarNumero}
          disabled={enviando || nuevoNumero.trim() === "" || nuevoNumero.trim() === factura.numero}
        >
          Guardar número
        </Button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="py-1.5" />
            <th className="py-1.5">Fecha</th>
            <th className="py-1.5">Folio</th>
            <th className="py-1.5"># de nota</th>
            <th className="py-1.5 text-right">Monto</th>
          </tr>
        </thead>
        <tbody>
          {factura.ventas.map((v) => (
            <tr key={v.id} className="border-t">
              <td className="py-1.5">
                <input
                  type="checkbox"
                  aria-label={`Quitar ${v.folio}`}
                  checked={marcadas.has(v.id)}
                  onChange={() =>
                    setMarcadas((actual) => {
                      const nueva = new Set(actual);
                      if (nueva.has(v.id)) nueva.delete(v.id);
                      else nueva.add(v.id);
                      return nueva;
                    })
                  }
                  disabled={enviando}
                />
              </td>
              <td className="py-1.5">{v.fecha}</td>
              <td className="py-1.5 font-mono">{v.folio}</td>
              <td className="py-1.5">{v.numNota ?? "—"}</td>
              <td className="py-1.5 text-right">{formatearPesos(v.montoCentavos)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Total: {formatearPesos(factura.totalCentavos)}</p>
        <Button variant="destructive" onClick={quitar} disabled={enviando || marcadas.size === 0}>
          Quitar de la factura
        </Button>
      </div>
    </section>
  );
}

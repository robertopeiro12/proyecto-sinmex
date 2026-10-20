"use client";

import { useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, Fila, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import { buscarPorCobrar, type NotaPorCobrar } from "@/lib/cobranzas";
import { hoyEnTijuana } from "@/lib/ventas";

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

  // Cuenta las búsquedas: solo la última puede escribir el resultado.
  const busqueda = useRef(0);

  useEffect(() => {
    // Otra sucursal = otro alcance: los resultados de la anterior ya no valen.
    busqueda.current += 1;
    setNotas(null);
    setError(null);
    setBuscando(false);
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
    const mia = ++busqueda.current;
    setBuscando(true);
    setError(null);
    try {
      const lista = await buscarPorCobrar(filtro, sucursal);
      if (mia === busqueda.current) setNotas(lista);
    } catch (err) {
      if (mia !== busqueda.current) return;
      setNotas(null);
      setError(mensajeDe(err, "No se pudieron buscar las notas por cobrar."));
    } finally {
      if (mia === busqueda.current) setBuscando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-[10px] border p-3.5">
        <BuscadorCliente clientes={clientes} cliente={null} onElegir={(c) => onElegir(c.id, null)} onQuitar={() => {}} />

        <div className="flex flex-wrap items-end gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void buscar({ fecha });
            }}
            className="flex items-end gap-2"
          >
            <Campo id="cobranza-fecha" etiqueta="Fecha de la venta">
              <Entrada type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Campo>
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
            <Campo id="cobranza-num-nota" etiqueta="# de nota">
              <Entrada maxLength={30} value={numNota} onChange={(e) => setNumNota(e.target.value)} className="w-40" />
            </Campo>
            <Button type="submit" variant="outline" disabled={buscando || numNota.trim() === ""}>
              Buscar por # de nota
            </Button>
          </form>
        </div>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      {notas !== null &&
        (notas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay notas por cobrar con esa búsqueda.</p>
        ) : (
          <CajaTabla>
            <Tabla className="min-w-[860px]">
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Fecha</Th>
                  <Th>Folio</Th>
                  <Th># de nota</Th>
                  <Th alinear="derecha">Total</Th>
                  <Th alinear="derecha">Saldo</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => (
                  <Fila key={n.id} interactiva>
                    <Td>
                      {n.cliente} · {n.sucursalCodigo}
                    </Td>
                    <Td>
                      <Fecha valor={n.fecha} />
                    </Td>
                    <Td className="font-mono">{n.folio}</Td>
                    <Td>{n.numNota ?? "—"}</Td>
                    <TdMonto centavos={n.montoCentavos} />
                    <TdMonto centavos={n.saldoCentavos} className="font-semibold" />
                    <Td>
                      <EtiquetaStatusVenta status={n.status} />
                    </Td>
                    <Td alinear="derecha">
                      <Button
                        type="button"
                        size="sm"
                        aria-label={`Cobrar ${n.folio}`}
                        onClick={() => onElegir(n.clienteId, n.id)}
                      >
                        Cobrar
                      </Button>
                    </Td>
                  </Fila>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        ))}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Casilla, Entrada } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
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
import { formatearFechaHora, formatearPesos, plural } from "@/lib/formato";

/** Buscar facturas por número o cliente, cambiar su número o quitarle ventas (T-19, §5.2). */
export function BuscarFacturas({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();
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

  // Sin esto, quien si tiene el permiso ve "No tienes permiso" un instante.
  if (cargandoSesion) return <EstadoPantalla tipo="cargando" />;
  if (!permitido) return <EstadoPantalla tipo="sin-permiso" />;

  async function alBuscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    // Se avanza el contador antes de validar: una búsqueda en vuelo no debe pisar este error.
    const mia = ++busqueda.current;
    if (numero.trim() === "" && !cliente) {
      setError("Escribe un número de factura o elige un cliente.");
      return;
    }
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
    setFacturas((actual) => (actual ?? []).flatMap((f) => (f.id !== id ? [f] : nueva ? [nueva] : [])));
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={alBuscar} className="flex flex-wrap items-end gap-3 rounded-[10px] border p-3.5">
        <Campo id="buscar-numero-factura" etiqueta="Número de factura a buscar">
          <Entrada
            maxLength={LARGO_MAX_NUMERO_FACTURA}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            className="w-48"
          />
        </Campo>
        <BuscadorCliente
          clientes={clientes}
          cliente={cliente}
          onElegir={setCliente}
          onQuitar={() => setCliente(null)}
          etiquetaQuitar="Quitar"
        />
        <Button type="submit">Buscar</Button>
      </form>

      {aviso && <Aviso tono="exito">{aviso}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

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
  const { confirmar, ventana } = useConfirmar();
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
    const si = await confirmar(
      todas
        ? {
            titulo: `¿Quitar todas las ventas de la factura ${factura.numero}?`,
            descripcion: `Regresan a "pendiente" y la factura ${factura.numero} desaparece.`,
            confirmar: "Quitar ventas",
          }
        : {
            titulo: `¿Quitar ${plural(marcadas.size, "venta", "ventas")} de la factura ${factura.numero}?`,
            descripcion: 'Regresan a "pendiente".',
            confirmar: "Quitar ventas",
          },
    );
    if (!si) return;
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
    <section aria-label={titulo} className="flex flex-col gap-3 rounded-[10px] border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{titulo}</h3>
        <p className="text-sm text-muted-foreground">
          {factura.cliente} · {factura.sucursalCodigo} · registró {factura.creadoPor} el{" "}
          {formatearFechaHora(factura.creadoEn)}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Campo id={`renombrar-${factura.id}`} etiqueta={`Nuevo número de ${factura.numero}`}>
          <Entrada
            maxLength={LARGO_MAX_NUMERO_FACTURA}
            value={nuevoNumero}
            onChange={(e) => setNuevoNumero(e.target.value)}
            disabled={enviando}
            className="w-48"
          />
        </Campo>
        <Button
          variant="outline"
          onClick={() => void guardarNumero()}
          disabled={enviando || nuevoNumero.trim() === "" || nuevoNumero.trim() === factura.numero}
        >
          Guardar número
        </Button>
      </div>

      <CajaTabla>
        <Tabla>
          <thead>
            <tr>
              <Th>
                <span className="sr-only">Quitar</span>
              </Th>
              <Th>Fecha</Th>
              <Th>Folio</Th>
              <Th># de nota</Th>
              <Th alinear="derecha">Monto</Th>
            </tr>
          </thead>
          <tbody>
            {factura.ventas.map((v) => (
              <tr key={v.id}>
                <Td>
                  <Casilla
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
                </Td>
                <Td>
                  <Fecha valor={v.fecha} />
                </Td>
                <Td className="font-mono">{v.folio}</Td>
                <Td>{v.numNota ?? "—"}</Td>
                <TdMonto centavos={v.montoCentavos} />
              </tr>
            ))}
          </tbody>
        </Tabla>
      </CajaTabla>

      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Total: {formatearPesos(factura.totalCentavos)}</p>
        <Button variant="destructive" onClick={() => void quitar()} disabled={enviando || marcadas.size === 0}>
          Quitar de la factura
        </Button>
      </div>

      {ventana}
    </section>
  );
}

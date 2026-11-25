"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Casilla, Entrada } from "@/components/ui/campo";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, Fila, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { BuscadorCliente } from "@/components/ventas/buscador-cliente";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  LARGO_MAX_NUMERO_FACTURA,
  asignarFactura,
  listarPorFacturar,
  totalSeleccionado,
  type VentaPorFacturar,
} from "@/lib/facturas";
import { formatearPesos, plural } from "@/lib/formato";

/**
 * Asignar factura a notas de ventas (T-19, §5.1 del spec): cliente → marcar
 * ventas → teclear el número del SAT. El servidor decide si se puede; aquí solo
 * se arma la selección.
 */
export function AsignarFactura({ sucursal }: { sucursal: string | null }) {
  const { puede, cargando: cargandoSesion } = useAuth();
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
        setErrorCarga(mensajeDe(err, "No se pudo cargar la lista de ventas por facturar."));
        setCargada(true);
      });
    return () => {
      vigente = false;
    };
  }, [cliente, incluirNA, recarga]);

  // Sin esto, quien si tiene el permiso ve "No tienes permiso" un instante.
  if (cargandoSesion) return <EstadoPantalla tipo="cargando" />;
  if (!permitido) return <EstadoPantalla tipo="sin-permiso" />;

  const total = totalSeleccionado(ventas, seleccion);
  // Mientras recarga la lista es la anterior: no se deja marcar filas viejas.
  const bloqueada = enviando || !cargada;
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
        setAviso(null);
        const factura = await asignarFactura(cliente.id, numero.trim(), ids);
        setAviso(`Factura ${factura.numero} asignada a ${plural(ids.length, "venta", "ventas")} (${formatearPesos(total)})`);
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
          setAviso(null);
          setVentas([]);
          setSeleccion(new Set());
        }}
        disabled={enviando}
      />

      {aviso && <Aviso tono="exito">{aviso}</Aviso>}

      {cliente && (
        <>
          <Casilla
            etiqueta="Mostrar también las N/A"
            checked={incluirNA}
            onChange={(e) => setIncluirNA(e.target.checked)}
            disabled={enviando}
          />

          {errorCarga ? (
            <Aviso tono="error">{errorCarga}</Aviso>
          ) : cargada && ventas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este cliente no tiene ventas por facturar.</p>
          ) : (
            <CajaTabla>
              <Tabla className="min-w-[720px]">
                <thead>
                  <tr>
                    <Th>
                      <Casilla
                        aria-label="Seleccionar todas"
                        checked={todas}
                        onChange={() => setSeleccion(todas ? new Set() : new Set(ventas.map((v) => v.id)))}
                        disabled={bloqueada}
                      />
                    </Th>
                    <Th>Fecha</Th>
                    <Th>Folio</Th>
                    <Th># de nota</Th>
                    <Th alinear="derecha">Monto</Th>
                    <Th>Status</Th>
                    <Th>Factura</Th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.map((v) => (
                    <Fila key={v.id} interactiva>
                      <Td>
                        <Casilla
                          aria-label={`Marcar ${v.folio}`}
                          checked={seleccion.has(v.id)}
                          onChange={() => alternar(v.id)}
                          disabled={bloqueada}
                        />
                      </Td>
                      <Td>
                        <Fecha valor={v.fecha} />
                      </Td>
                      <Td className="font-mono">{v.folio}</Td>
                      <Td>{v.numNota ?? "—"}</Td>
                      <TdMonto centavos={v.montoCentavos} />
                      <Td>
                        <EtiquetaStatusVenta status={v.status} />
                      </Td>
                      <Td>{v.factura}</Td>
                    </Fila>
                  ))}
                </tbody>
              </Tabla>
            </CajaTabla>
          )}

          <p className="text-right text-base font-semibold">Total marcado: {formatearPesos(total)}</p>

          <div className="flex flex-wrap items-end gap-3">
            <Campo id="numero-factura" etiqueta="Número de factura">
              <Entrada
                maxLength={LARGO_MAX_NUMERO_FACTURA}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                disabled={enviando}
                className="w-48"
              />
            </Campo>
            <Button type="submit" disabled={enviando || seleccion.size === 0 || numero.trim() === ""}>
              {enviando ? "Asignando…" : "Asignar"}
            </Button>
          </div>
        </>
      )}

      {error && <Aviso tono="error">{error}</Aviso>}
    </form>
  );
}

/**
 * *Procesos → Notas* (spec D2): anotar el número de factura en las ventas ya
 * marcadas en la lista. Va dentro de una `Ventana`; mismo backend que
 * `AsignarFactura` (`POST /facturas/asignar`), que decide si se puede.
 */
export function AnotarFactura({
  clienteId,
  ventas,
  onAnotada,
  onCancelar,
}: {
  clienteId: string;
  ventas: { id: string; montoCentavos: number }[];
  onAnotada: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  const [numero, setNumero] = useState("");
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo anotar la factura.");
  const total = ventas.reduce((t, v) => t + v.montoCentavos, 0);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    let mensaje = "";
    await enviar(
      async () => {
        const factura = await asignarFactura(
          clienteId,
          numero.trim(),
          ventas.map((v) => v.id),
        );
        mensaje = `Factura ${factura.numero} anotada en ${plural(ventas.length, "venta", "ventas")} (${formatearPesos(total)}).`;
      },
      () => onAnotada(mensaje),
    );
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {`${plural(ventas.length, "venta marcada", "ventas marcadas")} · ${formatearPesos(total)}. El número es el de la factura del SAT.`}
      </p>
      <Campo id="anotar-numero-factura" etiqueta="Número de factura">
        <Entrada
          maxLength={LARGO_MAX_NUMERO_FACTURA}
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          disabled={enviando}
          className="w-48"
        />
      </Campo>
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando || numero.trim() === ""}>
          {enviando ? "Anotando…" : "Anotar factura"}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PedirBorradoCobro } from "@/components/peticiones/pedir-borrado-cobro";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Casilla } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, Fila, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { ETIQUETA_METODO_PAGO, porCobrarDeCliente, type ClientePorCobrar } from "@/lib/cobranzas";
import { formatearFecha, formatearPesos } from "@/lib/formato";
import { ETIQUETA_BORRADO_PEDIDO } from "@/lib/peticiones";
import { marcarCuentaPerdida } from "@/lib/ventas";
import { AplicarSaldoFavor } from "./aplicar-saldo-favor";
import { RegistrarPago } from "./registrar-pago";

/** El aviso de arriba: salió bien (verde) o la pantalla quedó vieja y se recargó (ámbar). */
type AvisoCobranza = { texto: string; tono: "exito" | "advertencia" };

/**
 * §3.2: las notas por cobrar de un cliente, de la más vieja a la más nueva,
 * para marcar las que paga. El reparto lo calcula el servidor (vista previa) y
 * lo vuelve a decidir al grabar, con las notas bloqueadas: aquí solo se arma la
 * selección.
 */
export function CobranzaCliente({
  clienteId,
  notaInicial,
  onVolver,
}: {
  clienteId: string;
  notaInicial: string | null;
  onVolver: () => void;
}) {
  const { puede } = useAuth();
  const { confirmar, ventana } = useConfirmar();
  const [datos, setDatos] = useState<ClientePorCobrar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set(notaInicial ? [notaInicial] : []));
  const [aviso, setAviso] = useState<AvisoCobranza | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [marcando, setMarcando] = useState(false);
  // Sube con cada carga buena: los paneles de pago se remontan y sus vistas previas viejas desaparecen.
  const [version, setVersion] = useState(0);
  // El pago cuyo borrado se está pidiendo (T-34); uno a la vez. Toda recarga lo cierra.
  const [pidiendo, setPidiendo] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    porCobrarDeCliente(clienteId)
      .then((d) => {
        if (!vigente) return;
        setDatos(d);
        setVersion((v) => v + 1);
        setError(null);
        // Una nota que ya no está por cobrar (la pagó alguien) se desmarca sola.
        setSeleccion((actual) => new Set([...actual].filter((id) => d.notas.some((n) => n.id === id))));
      })
      .catch((err) => {
        if (!vigente) return;
        // Sin datos frescos no se muestra la tabla vieja ni el formulario de pago:
        // nadie debe cobrar sobre saldos que quizá ya cambiaron.
        setDatos(null);
        setError(mensajeDe(err, "No se pudo cargar la cobranza del cliente."));
      });
    return () => {
      vigente = false;
    };
  }, [clienteId, recarga]);

  const recargar = useCallback((texto: string, tono: AvisoCobranza["tono"] = "exito") => {
    setAviso({ texto, tono });
    setPidiendo(null);
    setRecarga((n) => n + 1);
  }, []);

  /** El 409 de "ya cambió": se recarga y el mensaje del servidor queda a la vista, en ámbar. */
  const recargarDesactualizado = useCallback((texto: string) => recargar(texto, "advertencia"), [recargar]);

  function alternar(id: string) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  async function marcarPerdida(id: string, folio: string) {
    const si = await confirmar({
      titulo: `¿Marcar la venta ${folio} como cuenta perdida?`,
      descripcion: "La venta dejará de cobrarse.",
      confirmar: "Marcar como perdida",
    });
    if (!si) return;
    setMarcando(true);
    setError(null);
    try {
      await marcarCuentaPerdida(id);
      setSeleccion((actual) => new Set([...actual].filter((x) => x !== id)));
      recargar(`La venta ${folio} quedó como cuenta perdida.`);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo marcar como cuenta perdida."));
    } finally {
      setMarcando(false);
    }
  }

  const palomeadas = datos ? datos.notas.filter((n) => seleccion.has(n.id)) : [];
  const puedePerdida = puede("venta.editar_eliminar");
  const puedePedirBorrado = puede("cobranza.editar_eliminar");

  function pedirBorrado(cobroId: string | null) {
    if (cobroId === null) return;
    setAviso(null);
    setPidiendo(cobroId);
  }

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo={datos ? `Cobranza · ${datos.nombre}` : "Cobranza"}
        descripcion="Marca las notas que paga el cliente, revisa la vista previa y graba el pago."
        acciones={
          <Button type="button" variant="outline" onClick={onVolver}>
            ← Volver a buscar
          </Button>
        }
      />

      {datos && datos.saldoFavorCentavos > 0 && (
        <p className="text-sm">
          Saldo a favor: <Monto centavos={datos.saldoFavorCentavos} className="font-semibold" />
        </p>
      )}

      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      {datos &&
        (datos.notas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este cliente no tiene notas por cobrar.</p>
        ) : (
          <CajaTabla>
            <Tabla className="min-w-[980px]">
              <thead>
                <tr>
                  <Th>
                    <span className="sr-only">Marcar</span>
                  </Th>
                  <Th>Fecha</Th>
                  <Th>Folio</Th>
                  <Th># de nota</Th>
                  <Th alinear="derecha">Total</Th>
                  <Th alinear="derecha">Saldo</Th>
                  <Th>Status</Th>
                  <Th>Abonos anteriores</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {datos.notas.map((n) => (
                  <Fila key={n.id} interactiva className="align-top">
                    <Td>
                      <Casilla
                        aria-label={`Marcar ${n.folio}`}
                        checked={seleccion.has(n.id)}
                        onChange={() => alternar(n.id)}
                      />
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
                    <Td>
                      {n.abonos.length === 0 ? (
                        "—"
                      ) : (
                        <details>
                          <summary className="cursor-pointer">
                            {n.abonos.length} {n.abonos.length === 1 ? "abono" : "abonos"}
                          </summary>
                          <ul>
                            {n.abonos.map((a, i) => (
                              <li key={`${a.fechaPago}-${i}`}>
                                {`${formatearFecha(a.fechaPago)} · ${formatearPesos(a.montoCentavos)} · ${ETIQUETA_METODO_PAGO[a.metodoPago] ?? a.metodoPago}`}
                                {a.cobroId !== null && a.peticionPendiente && (
                                  <span className="ml-2 text-muted-foreground">{ETIQUETA_BORRADO_PEDIDO}</span>
                                )}
                                {a.cobroId !== null && !a.peticionPendiente && puedePedirBorrado && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="ml-2"
                                    aria-label={`Pedir borrado del abono del ${formatearFecha(a.fechaPago)} por ${formatearPesos(a.montoCentavos)}`}
                                    disabled={pidiendo !== null}
                                    onClick={() => pedirBorrado(a.cobroId)}
                                  >
                                    Pedir borrado
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </Td>
                    <Td alinear="derecha">
                      {puedePerdida && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          aria-label={`Marcar ${n.folio} como cuenta perdida`}
                          disabled={marcando}
                          onClick={() => void marcarPerdida(n.id, n.folio)}
                        >
                          Marcar como cuenta perdida
                        </Button>
                      )}
                    </Td>
                  </Fila>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        ))}

      {pidiendo && (
        <PedirBorradoCobro
          key={pidiendo}
          cobroId={pidiendo}
          onEnviada={recargar}
          onDesactualizado={recargarDesactualizado}
          onCancelar={() => setPidiendo(null)}
        />
      )}

      {datos && palomeadas.length > 0 && (
        <RegistrarPago
          key={version}
          cliente={datos}
          palomeadas={palomeadas}
          onRegistrado={recargar}
          onDesactualizado={recargarDesactualizado}
        />
      )}

      {datos && datos.saldoFavorCentavos > 0 && palomeadas.length > 0 && (
        <AplicarSaldoFavor
          key={`${version}|${palomeadas.map((n) => n.id).join(",")}|${datos.saldoFavorCentavos}`}
          cliente={datos}
          palomeadas={palomeadas}
          onAplicado={recargar}
          onDesactualizado={recargarDesactualizado}
        />
      )}

      {ventana}
    </Pantalla>
  );
}

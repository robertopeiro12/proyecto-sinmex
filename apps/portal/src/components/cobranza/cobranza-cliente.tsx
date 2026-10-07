"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { ETIQUETA_METODO_PAGO, porCobrarDeCliente, type ClientePorCobrar } from "@/lib/cobranzas";
import { ETIQUETA_STATUS, formatearPesos, marcarCuentaPerdida } from "@/lib/ventas";
import { AplicarSaldoFavor } from "./aplicar-saldo-favor";
import { RegistrarPago } from "./registrar-pago";

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
  const [datos, setDatos] = useState<ClientePorCobrar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set(notaInicial ? [notaInicial] : []));
  const [aviso, setAviso] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [marcando, setMarcando] = useState(false);
  // Sube con cada carga buena: los paneles de pago se remontan y sus vistas previas viejas desaparecen.
  const [version, setVersion] = useState(0);

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

  const recargar = useCallback((mensaje: string | null) => {
    setAviso(mensaje);
    setRecarga((n) => n + 1);
  }, []);

  function alternar(id: string) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  async function marcarPerdida(id: string, folio: string) {
    if (!window.confirm(`La venta ${folio} dejará de cobrarse. ¿Continuar?`)) return;
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{datos ? `Cobranza · ${datos.nombre}` : "Cobranza"}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <Button type="button" variant="outline" onClick={onVolver}>
            ← Volver a buscar
          </Button>
        </div>

        {datos && datos.saldoFavorCentavos > 0 && (
          <p className="text-sm">
            Saldo a favor: <span className="font-semibold">{formatearPesos(datos.saldoFavorCentavos)}</span>
          </p>
        )}

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

        {datos &&
          (datos.notas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este cliente no tiene notas por cobrar.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-1.5" />
                  <th className="py-1.5">Fecha</th>
                  <th className="py-1.5">Folio</th>
                  <th className="py-1.5"># de nota</th>
                  <th className="py-1.5 text-right">Total</th>
                  <th className="py-1.5 text-right">Saldo</th>
                  <th className="py-1.5">Status</th>
                  <th className="py-1.5">Abonos anteriores</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {datos.notas.map((n) => (
                  <tr key={n.id} className="border-t align-top">
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Marcar ${n.folio}`}
                        checked={seleccion.has(n.id)}
                        onChange={() => alternar(n.id)}
                      />
                    </td>
                    <td className="py-1.5">{n.fecha}</td>
                    <td className="py-1.5 font-mono">{n.folio}</td>
                    <td className="py-1.5">{n.numNota ?? "—"}</td>
                    <td className="py-1.5 text-right">{formatearPesos(n.montoCentavos)}</td>
                    <td className="py-1.5 text-right font-semibold">{formatearPesos(n.saldoCentavos)}</td>
                    <td className="py-1.5">{ETIQUETA_STATUS[n.status]}</td>
                    <td className="py-1.5">
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
                                {`${a.fechaPago} · ${formatearPesos(a.montoCentavos)} · ${ETIQUETA_METODO_PAGO[a.metodoPago] ?? a.metodoPago}`}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {datos && palomeadas.length > 0 && (
          <RegistrarPago key={version} cliente={datos} palomeadas={palomeadas} onRegistrado={recargar} />
        )}

        {datos && datos.saldoFavorCentavos > 0 && palomeadas.length > 0 && (
          <AplicarSaldoFavor
            key={`${version}|${palomeadas.map((n) => n.id).join(",")}|${datos.saldoFavorCentavos}`}
            cliente={datos}
            palomeadas={palomeadas}
            onAplicado={recargar}
          />
        )}
      </CardContent>
    </Card>
  );
}

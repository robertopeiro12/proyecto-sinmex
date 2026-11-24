"use client";

import { useCallback, useEffect, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { AreaTexto, Campo } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, Tabla, Td, Th } from "@/components/ui/tabla";
import { Ventana } from "@/components/ui/ventana";
import { mensajeDe } from "@/lib/api";
import {
  autorizarRetiro,
  listarRetirosPendientes,
  MAX_MOTIVO_RECHAZO,
  rechazarRetiro,
  type OperacionAlmacen,
} from "@/lib/operaciones-almacen";
import { esConflicto409 } from "@/lib/peticiones";

const detalleDe = (o: OperacionAlmacen) => o.lineas.map((l) => `${l.nombre} × ${l.piezas}`).join(", ");

/**
 * Retiros de merma pendientes (Registro de Operación, parte 2): Administración los autoriza
 * o los rechaza con un motivo. El servidor decide con la fila bloqueada; aquí, salga bien o
 * con 409, la lista se vuelve a pedir para que no se quede vieja.
 */
export function BandejaRetirosMerma({ sucursal }: { sucursal: string | null }) {
  const [retiros, setRetiros] = useState<OperacionAlmacen[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [fin, setFin] = useState<{ aviso: string } | { alerta: string } | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [aRechazar, setARechazar] = useState<OperacionAlmacen | null>(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorRechazo, setErrorRechazo] = useState<string | null>(null);
  const { confirmar, ventana } = useConfirmar();

  useEffect(() => {
    let vigente = true;
    listarRetirosPendientes(sucursal)
      .then((r) => {
        if (!vigente) return;
        setRetiros(r.retiros);
        setErrorCarga(null);
      })
      .catch((err: unknown) => {
        if (!vigente) return;
        setRetiros(null);
        setErrorCarga(mensajeDe(err, "No se pudieron cargar los retiros de merma."));
      });
    return () => {
      vigente = false;
    };
  }, [sucursal, recarga]);

  const terminar = useCallback((resultado: { aviso: string } | { alerta: string }) => {
    setFin(resultado);
    setRecarga((n) => n + 1);
  }, []);

  async function autorizar(o: OperacionAlmacen) {
    setFin(null);
    const si = await confirmar({
      titulo: "¿Autorizar este retiro de merma?",
      descripcion: `Se autorizan ${o.piezas} piezas pedidas por ${o.capturo}. Ya no se podrá corregir ni eliminar.`,
      confirmar: "Autorizar retiro",
      tono: "normal",
    });
    if (!si) return;
    try {
      await autorizarRetiro(o.id);
      terminar({ aviso: "Retiro autorizado." });
    } catch (err) {
      if (esConflicto409(err)) terminar({ alerta: err.mensajeApi ?? "El retiro cambió; se recargó la lista." });
      else setFin({ alerta: mensajeDe(err, "No se pudo autorizar el retiro.") });
    }
  }

  function abrirRechazo(o: OperacionAlmacen) {
    setFin(null);
    setMotivo("");
    setErrorRechazo(null);
    setARechazar(o);
  }

  const motivoLimpio = motivo.trim();

  async function rechazar() {
    if (!aRechazar || motivoLimpio === "") return;
    setEnviando(true);
    setErrorRechazo(null);
    try {
      await rechazarRetiro(aRechazar.id, motivoLimpio);
      setARechazar(null);
      terminar({ aviso: "Retiro rechazado." });
    } catch (err) {
      if (esConflicto409(err)) {
        setARechazar(null);
        terminar({ alerta: err.mensajeApi ?? "El retiro cambió; se recargó la lista." });
      } else setErrorRechazo(mensajeDe(err, "No se pudo rechazar el retiro."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {fin && "aviso" in fin && <Aviso tono="exito">{fin.aviso}</Aviso>}
      {fin && "alerta" in fin && <Aviso tono="error">{fin.alerta}</Aviso>}
      {errorCarga && <Aviso tono="error">{errorCarga}</Aviso>}
      {retiros === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {retiros &&
        (retiros.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay retiros de merma pendientes.</p>
        ) : (
          <CajaTabla>
            <Tabla aria-label="Retiros de merma pendientes" className="min-w-[900px]">
              <thead>
                <tr>
                  <Th>Sucursal</Th>
                  <Th>Fecha</Th>
                  <Th>Pidió</Th>
                  <Th alinear="derecha">Piezas</Th>
                  <Th>Productos</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {retiros.map((o) => (
                  <tr key={o.id} className="align-top">
                    <Td>{o.sucursal.codigo}</Td>
                    <Td>
                      <Fecha valor={o.fecha} />
                    </Td>
                    <Td>{`${o.capturo} · ${o.hora}`}</Td>
                    <Td alinear="derecha">{o.piezas}</Td>
                    <Td>{detalleDe(o)}</Td>
                    <Td alinear="derecha">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          aria-label={`Autorizar retiro de ${o.capturo} en ${o.sucursal.codigo}`}
                          onClick={() => void autorizar(o)}
                        >
                          Autorizar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`Rechazar retiro de ${o.capturo} en ${o.sucursal.codigo}`}
                          onClick={() => abrirRechazo(o)}
                        >
                          Rechazar
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        ))}

      <Ventana abierta={aRechazar !== null} alCerrar={() => !enviando && setARechazar(null)} titulo="Rechazar retiro de merma">
        <div className="flex flex-col gap-3">
          <Campo id="rechazo-retiro-motivo" etiqueta="Motivo">
            <AreaTexto maxLength={MAX_MOTIVO_RECHAZO} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
          {errorRechazo && <Aviso tono="error">{errorRechazo}</Aviso>}
          <div className="flex gap-2">
            <Button type="button" onClick={() => void rechazar()} disabled={enviando || motivoLimpio === ""}>
              Confirmar rechazo
            </Button>
            <Button type="button" variant="ghost" onClick={() => setARechazar(null)} disabled={enviando}>
              Cancelar
            </Button>
          </div>
        </div>
      </Ventana>
      {ventana}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { AreaTexto, Campo } from "@/components/ui/campo";
import { Etiqueta, type TonoEtiqueta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { CajaTabla, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { formatearFechaHora } from "@/lib/formato";
import {
  ETIQUETA_STATUS_PETICION,
  LARGO_MAX_TEXTO,
  autorizarPeticion,
  denegarPeticion,
  describirPago,
  esConflicto409,
  listarPeticiones,
  textoAutorizada,
  textoDenegada,
  vistaPreviaDePeticion,
  type PeticionEnBandeja,
  type StatusPeticion,
  type VistaBorrado,
} from "@/lib/peticiones";
import { VistaBorradoPago } from "./vista-borrado";

type Accion = { tipo: "autorizar" | "denegar"; peticion: PeticionEnBandeja };

/** Cómo termina una acción: un aviso (salió bien) o una alerta (409: la pantalla quedó vieja). */
type Fin = { aviso: string } | { alerta: string };

/** Autorizada = el pago se borró (información); denegada = no pasó nada (gris). */
const TONO_PETICION: Record<StatusPeticion, TonoEtiqueta> = {
  pendiente: "advertencia",
  autorizada: "informacion",
  denegada: "neutro",
};

/**
 * La bandeja de peticiones (T-34, §3.2). La lista la arma el servidor con el
 * alcance del usuario; autorizar y denegar los vuelve a decidir el servidor con
 * la petición bloqueada. Toda acción, salga bien o con 409, cierra el panel y
 * recarga la lista: lo que se ve nunca se queda viejo.
 */
export function BandejaPeticiones({
  status,
  sucursal,
}: {
  status: "pendiente" | "historial";
  sucursal: string | null;
}) {
  const [peticiones, setPeticiones] = useState<PeticionEnBandeja[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [fin, setFin] = useState<Fin | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;
    listarPeticiones(status, sucursal)
      .then((lista) => {
        if (!vigente) return;
        setPeticiones(lista);
        setErrorCarga(null);
      })
      .catch((err) => {
        if (!vigente) return;
        setPeticiones(null);
        setErrorCarga(mensajeDe(err, "No se pudieron cargar las peticiones."));
      });
    return () => {
      vigente = false;
    };
  }, [status, sucursal, recarga]);

  const terminar = useCallback((resultado: Fin) => {
    setFin(resultado);
    setAccion(null);
    setRecarga((n) => n + 1);
  }, []);

  function abrir(tipo: Accion["tipo"], peticion: PeticionEnBandeja) {
    setFin(null);
    setAccion({ tipo, peticion });
  }

  const pendientes = status === "pendiente";

  return (
    <div className="flex flex-col gap-4">
      {fin && "aviso" in fin && <Aviso tono="exito">{fin.aviso}</Aviso>}
      {fin && "alerta" in fin && <Aviso tono="error">{fin.alerta}</Aviso>}
      {errorCarga && <Aviso tono="error">{errorCarga}</Aviso>}
      {peticiones === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {peticiones &&
        (peticiones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {pendientes ? "No hay peticiones pendientes." : "No hay peticiones resueltas."}
          </p>
        ) : (
          <CajaTabla>
            <Tabla className="min-w-[980px]">
              <thead>
                <tr>
                  <Th>Pedida</Th>
                  <Th>Pidió</Th>
                  <Th>Cliente</Th>
                  <Th>Pago</Th>
                  <Th>Notas</Th>
                  <Th>Motivo</Th>
                  {pendientes ? (
                    <Th>
                      <span className="sr-only">Acciones</span>
                    </Th>
                  ) : (
                    <>
                      <Th>Resultado</Th>
                      <Th>Resolvió</Th>
                      <Th>Comentario</Th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {peticiones.map((p) => (
                  <tr key={p.id} className="align-top">
                    <Td>
                      <Fecha valor={p.creadaEn} conHora />
                    </Td>
                    <Td>{p.solicito}</Td>
                    <Td>{`${p.cobro.cliente} · ${p.sucursalCodigo}`}</Td>
                    <Td>{describirPago(p.cobro)}</Td>
                    <Td className="font-mono">{p.cobro.folios.join(", ") || "—"}</Td>
                    <Td>{p.motivo}</Td>
                    {pendientes ? (
                      <Td alinear="derecha">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            aria-label={`Autorizar petición de ${p.cobro.cliente}`}
                            disabled={accion !== null}
                            onClick={() => abrir("autorizar", p)}
                          >
                            Autorizar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`Denegar petición de ${p.cobro.cliente}`}
                            disabled={accion !== null}
                            onClick={() => abrir("denegar", p)}
                          >
                            Denegar
                          </Button>
                        </div>
                      </Td>
                    ) : (
                      <>
                        <Td>
                          <Etiqueta tono={TONO_PETICION[p.status]}>{ETIQUETA_STATUS_PETICION[p.status]}</Etiqueta>
                        </Td>
                        <Td>{`${p.resolvio ?? "—"} · ${p.resueltaEn ? formatearFechaHora(p.resueltaEn) : "—"}`}</Td>
                        <Td>{p.comentario ?? "—"}</Td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        ))}

      {accion?.tipo === "autorizar" && (
        <AutorizarPeticion
          key={accion.peticion.id}
          peticion={accion.peticion}
          onTerminar={terminar}
          onCancelar={() => setAccion(null)}
        />
      )}
      {accion?.tipo === "denegar" && (
        <DenegarPeticion
          key={accion.peticion.id}
          peticion={accion.peticion}
          onTerminar={terminar}
          onCancelar={() => setAccion(null)}
        />
      )}
    </div>
  );
}

/** Autorizar: la vista previa recalculada al abrir, y confirmar. */
function AutorizarPeticion({
  peticion,
  onTerminar,
  onCancelar,
}: {
  peticion: PeticionEnBandeja;
  onTerminar: (fin: Fin) => void;
  onCancelar: () => void;
}) {
  const [vista, setVista] = useState<VistaBorrado | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo autorizar la petición.");
  // El efecto de carga depende solo de la petición: el aviso al padre se lee del ref.
  const avisar = useRef(onTerminar);
  useEffect(() => {
    avisar.current = onTerminar;
  });

  useEffect(() => {
    let vigente = true;
    vistaPreviaDePeticion(peticion.id)
      .then((v) => {
        if (vigente) setVista(v);
      })
      .catch((err) => {
        if (!vigente) return;
        if (esConflicto409(err)) {
          avisar.current({ alerta: err.mensajeApi ?? "La petición cambió; vuelve a cargar." });
          return;
        }
        setErrorCarga(mensajeDe(err, "No se pudo calcular la vista previa."));
      });
    return () => {
      vigente = false;
    };
  }, [peticion.id]);

  async function confirmar() {
    await enviar(
      async () => {
        try {
          onTerminar({ aviso: textoAutorizada(await autorizarPeticion(peticion.id)) });
        } catch (err) {
          if (esConflicto409(err)) {
            onTerminar({ alerta: err.mensajeApi ?? "La petición cambió; vuelve a cargar." });
            return;
          }
          throw err;
        }
      },
      () => {},
    );
  }

  return (
    <section aria-label="Autorizar petición" className="flex flex-col gap-3 rounded-[10px] border p-4">
      <h3 className="text-sm font-semibold">Autorizar: se borra el pago completo</h3>
      <p className="text-sm">{`Motivo: ${peticion.motivo}`}</p>
      {errorCarga && <Aviso tono="error">{errorCarga}</Aviso>}
      {vista === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {vista && <VistaBorradoPago vista={vista} />}
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          onClick={() => void confirmar()}
          disabled={enviando || vista === null || vista.bloqueo !== null}
        >
          Confirmar y borrar
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}

/** Denegar: comentario opcional. El pago no cambia. */
function DenegarPeticion({
  peticion,
  onTerminar,
  onCancelar,
}: {
  peticion: PeticionEnBandeja;
  onTerminar: (fin: Fin) => void;
  onCancelar: () => void;
}) {
  const [comentario, setComentario] = useState("");
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo denegar la petición.");

  async function confirmar() {
    await enviar(
      async () => {
        try {
          onTerminar({ aviso: textoDenegada(await denegarPeticion(peticion.id, comentario)) });
        } catch (err) {
          if (esConflicto409(err)) {
            onTerminar({ alerta: err.mensajeApi ?? "La petición cambió; vuelve a cargar." });
            return;
          }
          throw err;
        }
      },
      () => {},
    );
  }

  return (
    <section aria-label="Denegar petición" className="flex flex-col gap-3 rounded-[10px] border p-4">
      <h3 className="text-sm font-semibold">{`Denegar: ${describirPago(peticion.cobro)}`}</h3>
      <Campo id={`denegar-comentario-${peticion.id}`} etiqueta="Comentario" opcional>
        <AreaTexto maxLength={LARGO_MAX_TEXTO} value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </Campo>
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex gap-2">
        <Button type="button" onClick={() => void confirmar()} disabled={enviando}>
          Confirmar denegación
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}

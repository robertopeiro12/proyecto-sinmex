"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { mensajeDe } from "@/lib/api";
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
  type VistaBorrado,
} from "@/lib/peticiones";
import { VistaBorradoPago } from "./vista-borrado";

type Accion = { tipo: "autorizar" | "denegar"; peticion: PeticionEnBandeja };

/** Cómo termina una acción: un aviso (salió bien) o una alerta (409: la pantalla quedó vieja). */
type Fin = { aviso: string } | { alerta: string };

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
      {fin && "aviso" in fin && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {fin.aviso}
        </p>
      )}
      {fin && "alerta" in fin && (
        <p role="alert" className="text-sm text-destructive">
          {fin.alerta}
        </p>
      )}
      {errorCarga && (
        <p role="alert" className="text-sm text-destructive">
          {errorCarga}
        </p>
      )}
      {peticiones === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {peticiones &&
        (peticiones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {pendientes ? "No hay peticiones pendientes." : "No hay peticiones resueltas."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-1.5">Pedida</th>
                <th className="py-1.5">Pidió</th>
                <th className="py-1.5">Cliente</th>
                <th className="py-1.5">Pago</th>
                <th className="py-1.5">Notas</th>
                <th className="py-1.5">Motivo</th>
                {pendientes ? (
                  <th className="py-1.5" />
                ) : (
                  <>
                    <th className="py-1.5">Resultado</th>
                    <th className="py-1.5">Resolvió</th>
                    <th className="py-1.5">Comentario</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {peticiones.map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="py-1.5">{p.creadaEn}</td>
                  <td className="py-1.5">{p.solicito}</td>
                  <td className="py-1.5">{`${p.cobro.cliente} · ${p.sucursalCodigo}`}</td>
                  <td className="py-1.5">{describirPago(p.cobro)}</td>
                  <td className="py-1.5 font-mono">{p.cobro.folios.join(", ") || "—"}</td>
                  <td className="py-1.5">{p.motivo}</td>
                  {pendientes ? (
                    <td className="py-1.5 text-right">
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
                    </td>
                  ) : (
                    <>
                      <td className="py-1.5">{ETIQUETA_STATUS_PETICION[p.status]}</td>
                      <td className="py-1.5">{`${p.resolvio ?? "—"} · ${p.resueltaEn ?? "—"}`}</td>
                      <td className="py-1.5">{p.comentario ?? "—"}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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
    <section aria-label="Autorizar petición" className="flex flex-col gap-3 rounded-md border p-3">
      <h3 className="text-sm font-semibold">Autorizar: se borra el pago completo</h3>
      <p className="text-sm">{`Motivo: ${peticion.motivo}`}</p>
      {errorCarga && (
        <p role="alert" className="text-sm text-destructive">
          {errorCarga}
        </p>
      )}
      {vista === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {vista && <VistaBorradoPago vista={vista} />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
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
    <section aria-label="Denegar petición" className="flex flex-col gap-3 rounded-md border p-3">
      <h3 className="text-sm font-semibold">{`Denegar: ${describirPago(peticion.cobro)}`}</h3>
      <label className="flex flex-col gap-1 text-sm">
        Comentario (opcional)
        <textarea
          className="rounded-md border p-2"
          rows={2}
          maxLength={LARGO_MAX_TEXTO}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
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

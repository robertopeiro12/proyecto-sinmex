"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { mensajeDe } from "@/lib/api";
import {
  LARGO_MAX_TEXTO,
  esConflicto409,
  pedirBorrarCobro,
  textoPeticionEnviada,
  vistaBorradoDeCobro,
  type VistaBorrado,
} from "@/lib/peticiones";
import { VistaBorradoPago } from "./vista-borrado";

/**
 * Pedir el borrado de un pago (T-34, §3.1): la vista previa del servidor, el
 * motivo y enviar. Pedir no cambia nada: el pago sigue vivo hasta que alguien
 * con "Peticiones" lo autorice. Un 409 (otra persona ya lo pidió, o ya se
 * borró) no se queda aquí: el padre recarga y muestra el mensaje.
 */
export function PedirBorradoCobro({
  cobroId,
  onEnviada,
  onDesactualizado,
  onCancelar,
}: {
  cobroId: string;
  onEnviada: (mensaje: string) => void;
  onDesactualizado: (mensaje: string) => void;
  onCancelar: () => void;
}) {
  const [vista, setVista] = useState<VistaBorrado | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo enviar la petición.");
  // El efecto de carga depende solo del cobro: el aviso al padre se lee del ref.
  const avisarDesactualizado = useRef(onDesactualizado);
  useEffect(() => {
    avisarDesactualizado.current = onDesactualizado;
  });

  useEffect(() => {
    let vigente = true;
    vistaBorradoDeCobro(cobroId)
      .then((v) => {
        if (vigente) setVista(v);
      })
      .catch((err) => {
        if (!vigente) return;
        if (esConflicto409(err)) {
          avisarDesactualizado.current(err.mensajeApi ?? "Este cobro ya cambió; vuelve a cargar.");
          return;
        }
        setErrorCarga(mensajeDe(err, "No se pudo cargar el cobro."));
      });
    return () => {
      vigente = false;
    };
  }, [cobroId]);

  async function enviarPeticion() {
    await enviar(
      async () => {
        try {
          onEnviada(textoPeticionEnviada(await pedirBorrarCobro(cobroId, motivo)));
        } catch (err) {
          if (esConflicto409(err)) {
            onDesactualizado(err.mensajeApi ?? "Este cobro ya cambió; vuelve a cargar.");
            return;
          }
          throw err;
        }
      },
      () => {},
    );
  }

  return (
    <section aria-label="Pedir borrado del cobro" className="flex flex-col gap-3 rounded-md border p-3">
      <h3 className="text-sm font-semibold">Pedir borrado del cobro</h3>
      {errorCarga && (
        <p role="alert" className="text-sm text-destructive">
          {errorCarga}
        </p>
      )}
      {vista === null && errorCarga === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {vista && <VistaBorradoPago vista={vista} />}
      <label className="flex flex-col gap-1 text-sm">
        Motivo
        <textarea
          className="rounded-md border p-2"
          rows={3}
          maxLength={LARGO_MAX_TEXTO}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => void enviarPeticion()}
          disabled={enviando || vista === null || motivo.trim() === ""}
        >
          Enviar petición
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}

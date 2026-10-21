"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Casilla, Entrada } from "@/components/ui/campo";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { crearMotivoVisita, editarMotivoVisita, type MotivoVisita } from "@/lib/motivos-visita";

interface Props {
  motivo: MotivoVisita | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

/** Alta y edición de un motivo de visita: el nombre y las dos casillas (T-39, D5). */
export function FormularioMotivoVisita({ motivo, alGuardar, alCancelar }: Props) {
  const [nombre, setNombre] = useState(motivo?.nombre ?? "");
  const [exigeFoto, setExigeFoto] = useState(motivo?.exigeFoto ?? false);
  const [exigeAtendio, setExigeAtendio] = useState(motivo?.exigeAtendio ?? false);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el motivo.");

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = { nombre, exigeFoto, exigeAtendio };
    await enviar(() => (motivo ? editarMotivoVisita(motivo.id, datos) : crearMotivoVisita(datos)), alGuardar);
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <Campo id="motivo-nombre" etiqueta="Nombre del motivo">
        <Entrada
          id="motivo-nombre"
          required
          maxLength={80}
          disabled={enviando}
          placeholder="Cerrado, Sin dinero, Tenía producto…"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </Campo>

      <div className="flex flex-col gap-2">
        <Casilla
          etiqueta="Exige foto"
          checked={exigeFoto}
          disabled={enviando}
          onChange={(e) => setExigeFoto(e.target.checked)}
        />
        <Casilla
          etiqueta="Exige nombre de quien atendió"
          checked={exigeAtendio}
          disabled={enviando}
          onChange={(e) => setExigeAtendio(e.target.checked)}
        />
        <p className="text-xs text-muted-foreground">
          Las casillas las exige la tablet al guardar la visita. Si las cambias, las visitas ya capturadas sin red suben
          igual.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}

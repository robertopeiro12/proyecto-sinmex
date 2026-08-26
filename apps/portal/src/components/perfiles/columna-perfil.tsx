"use client";

import { useState } from "react";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { renombrarPerfil, darDeBajaPerfil, type Perfil } from "@/lib/perfiles";

interface Props {
  perfil: Perfil;
  /** Recarga la matriz del padre: una baja quita la columna, un renombre le cambia el titulo. */
  alCambiar: () => void;
}

export function ColumnaPerfil({ perfil, alCambiar }: Props) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(perfil.nombre);
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo actualizar el perfil.",
  );

  if (perfil.esMaestro) {
    return <span>{perfil.nombre}</span>;
  }

  async function guardarNombre() {
    const recortado = nombre.trim();
    if (!recortado || recortado === perfil.nombre) {
      setEditando(false);
      setNombre(perfil.nombre);
      return;
    }
    await enviar(
      () => renombrarPerfil(perfil.id, recortado),
      () => {
        setEditando(false);
        alCambiar();
      },
    );
  }

  async function confirmarBaja() {
    if (!window.confirm(`¿Dar de baja el perfil "${perfil.nombre}"?`)) return;
    await enviar(() => darDeBajaPerfil(perfil.id), alCambiar);
  }

  if (editando) {
    return (
      <div className="flex flex-col gap-1">
        <input
          aria-label="Nombre del perfil"
          value={nombre}
          disabled={enviando}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={() => void guardarNombre()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-32 rounded-md border px-2 py-1 text-sm font-normal"
        />
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setEditando(true)}
        className="text-left font-medium"
      >
        {perfil.nombre}
      </button>
      <button
        type="button"
        onClick={() => void confirmarBaja()}
        disabled={enviando}
        className="text-left text-xs font-normal text-destructive"
      >
        Dar de baja
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

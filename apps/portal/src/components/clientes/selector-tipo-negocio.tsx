"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
import {
  crearTipoNegocio,
  listarTiposNegocio,
  type TipoNegocio,
} from "@/lib/tipos-negocio";

const NUEVO = "__nuevo__";

interface Props {
  /** "" = sin tipo de negocio asignado. */
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export function SelectorTipoNegocio({ value, onChange, disabled }: Props) {
  const [tipos, setTipos] = useState<TipoNegocio[]>([]);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarTiposNegocio()
      .then((lista) => {
        if (vigente) setTipos(lista);
      })
      .catch(() => {
        // El desplegable se queda vacio salvo "+ Nuevo…": el usuario sigue
        // pudiendo crear uno, que es el camino que mas importa cubrir.
      });
    return () => {
      vigente = false;
    };
  }, []);

  function alCambiarSelect(id: string) {
    if (id === NUEVO) {
      setCreando(true);
      return;
    }
    onChange(id);
  }

  async function crear() {
    const nombre = nombreNuevo.trim();
    if (!nombre) return;
    setGuardando(true);
    setError(null);
    try {
      const tipo = await crearTipoNegocio(nombre);
      setTipos((previos) =>
        [...previos, tipo].sort((a, b) => a.nombre.localeCompare(b.nombre)),
      );
      onChange(tipo.id);
      setCreando(false);
      setNombreNuevo("");
    } catch {
      setError("No se pudo crear el tipo de negocio.");
    } finally {
      setGuardando(false);
    }
  }

  if (creando) {
    return (
      <Campo id="tipo-negocio-nuevo" etiqueta="Nuevo tipo de negocio" error={error}>
        <div className="flex gap-2">
          <Entrada
            id="tipo-negocio-nuevo"
            autoFocus
            disabled={guardando}
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
            className="flex-1"
            placeholder="Restaurante, tienda, ..."
          />
          <Button
            type="button"
            size="sm"
            disabled={guardando || !nombreNuevo.trim()}
            onClick={() => void crear()}
          >
            {guardando ? "Creando…" : "Crear"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={guardando}
            onClick={() => {
              setCreando(false);
              setNombreNuevo("");
            }}
          >
            Cancelar
          </Button>
        </div>
      </Campo>
    );
  }

  return (
    <Campo id="tipo-negocio" etiqueta="Tipo de negocio">
      <Lista
        id="tipo-negocio"
        disabled={disabled}
        value={value}
        onChange={(e) => alCambiarSelect(e.target.value)}
        className="w-64"
      >
        <option value="">Sin especificar</option>
        {tipos.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre}
          </option>
        ))}
        <option value={NUEVO}>+ Nuevo tipo de negocio…</option>
      </Lista>
    </Campo>
  );
}

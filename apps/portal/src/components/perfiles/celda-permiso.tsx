"use client";

import { useState } from "react";
import { togglePermiso as togglePermisoApi } from "@/lib/perfiles";

interface Props {
  perfilId: string;
  permisoId: string;
  habilitadoInicial: boolean;
  editable: boolean;
  /** Identifica la celda para lectores de pantalla: "<permiso> · <perfil>". */
  etiqueta: string;
}

/**
 * Estado local propio, arranca de `habilitadoInicial` una sola vez -- mismo
 * criterio que CeldaPrecio (T-18). A diferencia de esa pantalla, aqui no hay
 * un selector que remonte la matriz entera; el checkbox guarda al momento
 * (onChange, no onBlur) y revierte si el PATCH falla.
 */
export function CeldaPermiso({
  perfilId,
  permisoId,
  habilitadoInicial,
  editable,
  etiqueta,
}: Props) {
  const [habilitado, setHabilitado] = useState(habilitadoInicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(false);

  async function alCambiar(nuevoValor: boolean) {
    setHabilitado(nuevoValor);
    setGuardando(true);
    setError(false);
    try {
      await togglePermisoApi(perfilId, permisoId, nuevoValor);
    } catch {
      setHabilitado(!nuevoValor);
      setError(true);
    } finally {
      setGuardando(false);
    }
  }

  if (!editable) {
    return (
      <input
        type="checkbox"
        checked={habilitado}
        disabled
        aria-label={`${etiqueta} (perfil maestro, siempre habilitado)`}
      />
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="checkbox"
        aria-label={etiqueta}
        checked={habilitado}
        disabled={guardando}
        onChange={(e) => void alCambiar(e.target.checked)}
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          No se pudo guardar
        </span>
      )}
    </div>
  );
}

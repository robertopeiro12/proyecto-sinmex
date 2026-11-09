"use client";

import { useRef, useState } from "react";
import { mensajeDe } from "@/lib/api";

export type EstadoDetalle<D> =
  | { tipo: "cargando" }
  | { tipo: "listo"; datos: D }
  | { tipo: "error"; mensaje: string };

/**
 * El renglón abierto. `pestana` es la que se VE (también la que el usuario eligió dentro del
 * detalle, vía `cambiarPestana`). `vez` cambia solo cuando el renglón manda a una pestaña
 * (abrirlo, picar un número): úsala de `key` del detalle para que vuelva a montarse ahí;
 * un cambio de pestaña hecho dentro del detalle no lo vuelve a montar.
 */
export interface RenglonAbierto<P extends string> {
  clave: string;
  pestana: P;
  vez: number;
}

/**
 * Un renglón abierto a la vez, con su detalle pedido al abrirlo (spec §8: sin N+1). Picar el
 * renglón lo abre o lo cierra; picar un número abre su pestaña (o cierra si ya era esa).
 * Solo la última petición escribe: una lenta que llega tarde no pisa a la nueva.
 */
export function useDetalleAbierto<D, P extends string>(pedir: (clave: string) => Promise<D>, pestanaPorDefecto: P) {
  const [abierto, setAbierto] = useState<RenglonAbierto<P> | null>(null);
  const [estado, setEstado] = useState<EstadoDetalle<D>>({ tipo: "cargando" });
  const ultima = useRef(0);
  const veces = useRef(0);

  /** `silencioso`: una actualización; deja ver lo que ya había mientras llega y si falla. */
  async function cargar(clave: string, silencioso = false) {
    const esta = ++ultima.current;
    if (!silencioso) setEstado({ tipo: "cargando" });
    try {
      const datos = await pedir(clave);
      if (esta === ultima.current) setEstado({ tipo: "listo", datos });
    } catch (err) {
      if (esta !== ultima.current) return;
      const error: EstadoDetalle<D> = { tipo: "error", mensaje: mensajeDe(err, "No se pudo cargar el detalle.") };
      setEstado((antes) => (silencioso && antes.tipo === "listo" ? antes : error));
    }
  }

  function cerrar() {
    ultima.current++;
    setAbierto(null);
  }

  function mostrar(clave: string, pestana: P) {
    setAbierto({ clave, pestana, vez: ++veces.current });
  }

  /** El renglón (o su nombre): abre en la pestaña por defecto o cierra. */
  function alternar(clave: string) {
    if (abierto?.clave === clave) return cerrar();
    mostrar(clave, pestanaPorDefecto);
    void cargar(clave);
  }

  /** Un número o un "Ver": abre en esa pestaña; si ya se estaba viendo esa, cierra. */
  function abrirEn(clave: string, pestana: P) {
    if (abierto?.clave === clave) {
      if (abierto.pestana === pestana) return cerrar();
      mostrar(clave, pestana);
      return;
    }
    mostrar(clave, pestana);
    void cargar(clave);
  }

  /** El usuario cambió de pestaña dentro del detalle: se recuerda, sin volver a montarlo. */
  function cambiarPestana(pestana: P) {
    setAbierto((antes) => (antes ? { ...antes, pestana } : antes));
  }

  /** Vuelve a pedir el detalle abierto (la actualización del Dashboard), sin cerrarlo ni cambiar de pestaña. */
  function recargar() {
    if (abierto) void cargar(abierto.clave, true);
  }

  return { abierto, estado, alternar, abrirEn, cambiarPestana, recargar, cerrar };
}

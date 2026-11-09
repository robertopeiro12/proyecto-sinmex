"use client";

import { useRef, useState } from "react";
import { mensajeDe } from "@/lib/api";

export type EstadoDetalle<D> =
  | { tipo: "cargando" }
  | { tipo: "listo"; datos: D }
  | { tipo: "error"; mensaje: string };

/**
 * El renglón cuyo detalle está en la ventana. `pestana` es la que se VE (también la que el
 * usuario eligió dentro, vía `cambiarPestana`; el título de la ventana la sigue). `vez` cambia
 * solo cuando el renglón manda a una pestaña (picar el nombre o un número): úsala de `key` del
 * detalle para que vuelva a montarse ahí; un cambio de pestaña hecho dentro no lo vuelve a montar.
 */
export interface RenglonAbierto<P extends string> {
  clave: string;
  pestana: P;
  vez: number;
}

/**
 * Un renglón abierto a la vez, en una ventana, con su detalle pedido al abrirlo (spec §8: sin
 * N+1). Picar el renglón (o su nombre) abre en la pestaña por defecto; picar un número abre en
 * su pestaña. La ventana se cierra con su ✕, Escape o un clic fuera (`cerrar`).
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

  /** Un número o un "Ver": abre la ventana en esa pestaña (ya abierta en ese renglón, solo la cambia). */
  function abrirEn(clave: string, pestana: P) {
    const mismo = abierto?.clave === clave;
    mostrar(clave, pestana);
    if (!mismo) void cargar(clave);
  }

  /** El renglón (o su nombre): abre la ventana en la pestaña por defecto. */
  function abrir(clave: string) {
    abrirEn(clave, pestanaPorDefecto);
  }

  /** El usuario cambió de pestaña dentro del detalle: se recuerda, sin volver a montarlo. */
  function cambiarPestana(pestana: P) {
    setAbierto((antes) => (antes ? { ...antes, pestana } : antes));
  }

  /** Vuelve a pedir el detalle abierto (la actualización del Dashboard), sin cerrar la ventana ni cambiar de pestaña. */
  function recargar() {
    if (abierto) void cargar(abierto.clave, true);
  }

  // Lo último que se abrió: la ventana lo sigue mostrando mientras se desvanece al cerrarse
  // (si no, el título se vacía y el detalle salta a su pestaña por defecto un instante).
  const ultimo = useRef<RenglonAbierto<P> | null>(null);
  if (abierto) ultimo.current = abierto;
  const visto = abierto ?? ultimo.current;

  return { abierto, visto, estado, abrir, abrirEn, cambiarPestana, recargar, cerrar };
}

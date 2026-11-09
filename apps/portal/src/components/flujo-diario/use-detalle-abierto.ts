"use client";

import { useRef, useState } from "react";
import { mensajeDe } from "@/lib/api";

export type EstadoDetalle<D> =
  | { tipo: "cargando" }
  | { tipo: "listo"; datos: D }
  | { tipo: "error"; mensaje: string };

/**
 * Un renglón abierto a la vez, con su detalle pedido al abrirlo (spec §8: sin N+1). Picar el
 * renglón lo abre o lo cierra; picar un número abre su pestaña (o cierra si ya era esa).
 * Solo la última petición escribe: una lenta que llega tarde no pisa a la nueva.
 */
export function useDetalleAbierto<D, P extends string>(pedir: (clave: string) => Promise<D>, pestanaPorDefecto: P) {
  const [abierto, setAbierto] = useState<{ clave: string; pestana: P } | null>(null);
  const [estado, setEstado] = useState<EstadoDetalle<D>>({ tipo: "cargando" });
  const ultima = useRef(0);

  async function cargar(clave: string) {
    const esta = ++ultima.current;
    setEstado({ tipo: "cargando" });
    try {
      const datos = await pedir(clave);
      if (esta === ultima.current) setEstado({ tipo: "listo", datos });
    } catch (err) {
      if (esta === ultima.current) setEstado({ tipo: "error", mensaje: mensajeDe(err, "No se pudo cargar el detalle.") });
    }
  }

  function cerrar() {
    ultima.current++;
    setAbierto(null);
  }

  /** El renglón (o su nombre): abre en la pestaña por defecto o cierra. */
  function alternar(clave: string) {
    if (abierto?.clave === clave) return cerrar();
    setAbierto({ clave, pestana: pestanaPorDefecto });
    void cargar(clave);
  }

  /** Un número o un "Ver": abre en esa pestaña; si ya estaba abierto en ella, cierra. */
  function abrirEn(clave: string, pestana: P) {
    if (abierto?.clave === clave) {
      if (abierto.pestana === pestana) return cerrar();
      setAbierto({ clave, pestana });
      return;
    }
    setAbierto({ clave, pestana });
    void cargar(clave);
  }

  return { abierto, estado, alternar, abrirEn };
}

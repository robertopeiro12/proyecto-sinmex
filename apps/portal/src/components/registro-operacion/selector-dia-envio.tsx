"use client";

import { SelectorSegmentado } from "@/components/ui/selector-segmentado";
import { diaAnterior } from "@/lib/fechas";
import { hoyEnTijuana } from "@/lib/ventas";

/** Un envío solo vive hoy o ayer: cualquier otro día cae en hoy. */
export function diaDeEnvio(fecha: string): string {
  const hoy = hoyEnTijuana();
  return fecha === diaAnterior(hoy) ? fecha : hoy;
}

/** Hoy · Ayer, con el elegido resaltado (sustituye al calendario en Envíos). */
export function SelectorDiaEnvio({ valor, onCambio }: { valor: string; onCambio: (fecha: string) => void }) {
  const hoy = hoyEnTijuana();
  return (
    <SelectorSegmentado
      etiqueta="Día del envío"
      resaltado
      valor={diaDeEnvio(valor)}
      onCambio={onCambio}
      opciones={[
        { valor: hoy, texto: "Hoy" },
        { valor: diaAnterior(hoy), texto: "Ayer" },
      ]}
    />
  );
}

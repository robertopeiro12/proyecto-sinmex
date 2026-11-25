"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * Selector segmentado: dos o tres opciones excluyentes en una tira (la maqueta del Dashboard).
 * Es un `radiogroup` con tabindex móvil: solo la elegida entra con Tab; las flechas mueven y
 * eligen, dando la vuelta en los extremos.
 */
export function SelectorSegmentado<T extends string>({
  opciones,
  valor,
  onCambio,
  etiqueta,
  resaltado = false,
  deshabilitado = false,
}: {
  opciones: { valor: T; texto: string }[];
  valor: T;
  onCambio: (v: T) => void;
  etiqueta: string;
  /** La elegida en relleno oscuro y un poco más grande, para cuando es la única forma de elegir (Envíos: Hoy · Ayer). */
  resaltado?: boolean;
  /** Ninguna opción se puede elegir (Notas, con el cobro abierto). */
  deshabilitado?: boolean;
}) {
  // Si `valor` no coincide con ninguna opción, la primera es la tabulable.
  const hayElegida = opciones.some((o) => o.valor === valor);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);

  function alTeclear(e: KeyboardEvent<HTMLButtonElement>, indice: number) {
    const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (paso === 0) return;
    e.preventDefault();
    const destino = (indice + paso + opciones.length) % opciones.length;
    botones.current[destino]?.focus();
    onCambio(opciones[destino].valor);
  }

  return (
    <div
      role="radiogroup"
      aria-label={etiqueta}
      className="inline-flex gap-0.5 rounded-lg border bg-menu p-0.5">
      {opciones.map((o, i) => {
        const elegida = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={(el) => {
              botones.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={elegida}
            disabled={deshabilitado}
            tabIndex={elegida || (!hayElegida && i === 0) ? 0 : -1}
            onClick={() => onCambio(o.valor)}
            onKeyDown={(e) => alTeclear(e, i)}
            className={cn(
              "rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sucursal disabled:cursor-not-allowed disabled:opacity-50",
              resaltado ? "px-5 py-2 text-sm font-semibold" : "px-3.5 py-1.5 text-[13px] font-medium",
              elegida
                ? resaltado
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-card text-card-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}>
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

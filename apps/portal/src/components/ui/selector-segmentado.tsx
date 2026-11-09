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
}: {
  opciones: { valor: T; texto: string }[];
  valor: T;
  onCambio: (v: T) => void;
  etiqueta: string;
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
            tabIndex={elegida || (!hayElegida && i === 0) ? 0 : -1}
            onClick={() => onCambio(o.valor)}
            onKeyDown={(e) => alTeclear(e, i)}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sucursal",
              elegida
                ? "bg-card text-card-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}>
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

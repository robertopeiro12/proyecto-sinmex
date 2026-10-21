"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import { Info } from "lucide-react";

/**
 * Un ⓘ que explica algo sin ocupar lugar en la pantalla: el globito sale al pasar el
 * mouse o al llegar con el teclado (base-ui Tooltip) y Escape lo cierra. `tema` dice de
 * qué es la ayuda, para el lector de pantalla ("Qué permite: Ver Tesorería").
 */
export function Ayuda({ texto, tema }: { texto: string; tema: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={150}
        aria-label={`Qué permite: ${tema}`}
        className="inline-grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-sucursal"
      >
        <Info aria-hidden className="size-3.5" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={6} className="z-50">
          <Tooltip.Popup className="max-w-[18rem] rounded-[7px] bg-foreground px-2.5 py-1.5 text-xs leading-snug font-normal text-background shadow-[0_8px_24px_rgb(0_0_0/0.18)] transition-[opacity,scale] duration-150 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            {texto}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

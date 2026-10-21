"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

const ANCHOS = {
  normal: "w-[min(32rem,92vw)]",
  ancho: "w-[min(44rem,92vw)]",
} as const;

/**
 * La ventana de los formularios cortos (UI Etapa 2), base-ui Dialog: el foco entra al
 * primer campo, Escape o un clic fuera la cierran y el resto de la pantalla queda inerte.
 * No trae botones: el formulario que va dentro pone los suyos (Guardar, Cancelar).
 */
export function Ventana({
  abierta,
  alCerrar,
  titulo,
  ancho = "normal",
  children,
}: {
  abierta: boolean;
  alCerrar: () => void;
  titulo: string;
  ancho?: "normal" | "ancho";
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={abierta}
      onOpenChange={(abrir) => {
        if (!abrir) alCerrar();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgb(15_20_18/0.45)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={`fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] ${ANCHOS[ancho]} -translate-x-1/2 -translate-y-1/2 flex-col gap-2.5 overflow-y-auto rounded-xl bg-background p-[22px] shadow-[0_20px_50px_rgb(0_0_0/0.25)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0`}
        >
          <Dialog.Title className="font-titulo text-[19px] leading-snug font-bold">{titulo}</Dialog.Title>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

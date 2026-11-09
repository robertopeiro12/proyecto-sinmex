"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

const ANCHOS = {
  normal: "w-[min(32rem,92vw)]",
  ancho: "w-[min(44rem,92vw)]",
  detalle: "w-[min(72rem,94vw)]",
} as const;

const FONDO =
  "fixed inset-0 z-50 bg-[rgb(15_20_18/0.45)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0";
const POPUP =
  "fixed left-1/2 z-50 flex max-h-[90dvh] -translate-x-1/2 flex-col rounded-xl bg-background shadow-[0_20px_50px_rgb(0_0_0/0.25)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0";
const TITULO = "font-titulo text-[19px] leading-snug font-bold";

/**
 * La ventana de los formularios cortos (UI Etapa 2), base-ui Dialog: el foco entra al
 * primer campo, Escape o un clic fuera la cierran y el resto de la pantalla queda inerte.
 * No trae botones: el formulario que va dentro pone los suyos (Guardar, Cancelar).
 *
 * `ancho="detalle"`: la ventana grande del detalle de un renglón (Flujo diario, Dashboard),
 * como las del sistema viejo. Trae su ✕, el título queda fijo arriba y el contenido se
 * desplaza dentro; se ancla arriba (no al centro) para no brincar al cambiar de pestaña.
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
  ancho?: keyof typeof ANCHOS;
  children: ReactNode;
}) {
  const detalle = ancho === "detalle";
  return (
    <Dialog.Root
      open={abierta}
      onOpenChange={(abrir) => {
        if (!abrir) alCerrar();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={FONDO} />
        {detalle ? (
          <Dialog.Popup className={`${POPUP} top-[5dvh] ${ANCHOS[ancho]} overflow-hidden`}>
            <div className="flex items-start justify-between gap-4 border-b px-[22px] pt-[18px] pb-3">
              <Dialog.Title className={TITULO}>{titulo}</Dialog.Title>
              <Dialog.Close
                aria-label="Cerrar"
                className="-mt-0.5 -mr-1.5 rounded-md p-1.5 text-muted-foreground outline-none transition-colors hover:bg-menu hover:text-foreground focus-visible:ring-2 focus-visible:ring-sucursal"
              >
                <X aria-hidden className="size-[18px]" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 overflow-y-auto px-[22px] pt-4 pb-6">{children}</div>
          </Dialog.Popup>
        ) : (
          <Dialog.Popup
            className={`${POPUP} top-1/2 ${ANCHOS[ancho]} -translate-y-1/2 gap-2.5 overflow-y-auto p-[22px]`}
          >
            <Dialog.Title className={TITULO}>{titulo}</Dialog.Title>
            {children}
          </Dialog.Popup>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

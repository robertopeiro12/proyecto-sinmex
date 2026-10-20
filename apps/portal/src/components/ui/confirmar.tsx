"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";

export interface OpcionesConfirmar {
  /** "¿Eliminar la venta TJ261006AP05?" */
  titulo: string;
  /** Una línea de qué pasa: "No se puede deshacer." */
  descripcion: string;
  /** El verbo exacto del botón: "Eliminar venta", "Marcar como perdida". */
  confirmar: string;
  /** `peligro` (rojo, el default) para lo que borra o no tiene vuelta; `normal` para lo demás. */
  tono?: "peligro" | "normal";
}

/**
 * La ventana de confirmar (UI Etapa 1, spec §4.4), base-ui AlertDialog: el foco entra a
 * la ventana, Escape cancela y el resto de la pantalla queda inerte mientras está abierta.
 */
export function Confirmar({
  abierta,
  opciones,
  onRespuesta,
}: {
  abierta: boolean;
  opciones: OpcionesConfirmar | null;
  onRespuesta: (si: boolean) => void;
}) {
  return (
    <AlertDialog.Root
      open={abierta}
      onOpenChange={(abrir) => {
        if (!abrir) onRespuesta(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-[rgb(15_20_18/0.45)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-2.5 rounded-xl bg-background p-[22px] shadow-[0_20px_50px_rgb(0_0_0/0.25)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          <AlertDialog.Title className="font-titulo text-[19px] leading-snug font-bold">{opciones?.titulo}</AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted-foreground">{opciones?.descripcion}</AlertDialog.Description>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onRespuesta(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={opciones?.tono === "normal" ? "default" : "peligro"}
              onClick={() => onRespuesta(true)}
            >
              {opciones?.confirmar}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * `const { confirmar, ventana } = useConfirmar();` — la pantalla pinta `{ventana}` y en
 * su acción hace `if (!(await confirmar({...}))) return;`. Reemplaza a `window.confirm`.
 * Cada pregunta se contesta una sola vez; una pregunta nueva contesta "no" a la que
 * siguiera abierta, y desmontar la pantalla contesta "no" a la pendiente.
 */
export function useConfirmar(): {
  confirmar: (opciones: OpcionesConfirmar) => Promise<boolean>;
  ventana: ReactNode;
} {
  const [estado, setEstado] = useState<{ abierta: boolean; opciones: OpcionesConfirmar | null }>({
    abierta: false,
    opciones: null,
  });
  const pendiente = useRef<((si: boolean) => void) | null>(null);

  const responder = useCallback((si: boolean) => {
    const resolver = pendiente.current;
    pendiente.current = null;
    // Se conservan las opciones al cerrar: el texto no desaparece durante la animación de salida.
    setEstado((actual) => ({ ...actual, abierta: false }));
    resolver?.(si);
  }, []);

  const confirmar = useCallback(
    (opciones: OpcionesConfirmar) =>
      new Promise<boolean>((resolver) => {
        pendiente.current?.(false);
        pendiente.current = resolver;
        setEstado({ abierta: true, opciones });
      }),
    [],
  );

  useEffect(
    () => () => {
      pendiente.current?.(false);
      pendiente.current = null;
    },
    [],
  );

  return {
    confirmar,
    ventana: <Confirmar abierta={estado.abierta} opciones={estado.opciones} onRespuesta={responder} />,
  };
}

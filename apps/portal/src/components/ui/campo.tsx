"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Campos de formulario (UI Etapa 1, spec §4.6): mismo tamaño, borde visible al
 * escribir (en el color de la sucursal), aspecto de deshabilitado y "(opcional)".
 */

interface ContextoCampo {
  id: string;
  describidoPor: string | undefined;
  invalido: boolean;
}

const Contexto = createContext<ContextoCampo | null>(null);

type AriaInvalido = ComponentProps<"input">["aria-invalid"];

/** Lo que un control toma de su Campo. Lo que el control traiga explícito gana. */
function atributosDeCampo(
  campo: ContextoCampo | null,
  propio: { id?: string; "aria-invalid"?: AriaInvalido; "aria-describedby"?: string },
) {
  return {
    id: propio.id ?? campo?.id,
    "aria-invalid": propio["aria-invalid"] ?? (campo?.invalido ? true : undefined),
    "aria-describedby": propio["aria-describedby"] ?? campo?.describidoPor,
  };
}

const CLASE_CONTROL =
  "h-9 rounded-[7px] border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-sucursal focus-visible:ring-2 focus-visible:ring-sucursal/25 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive";

export function Campo({
  id,
  etiqueta,
  opcional = false,
  ayuda,
  error,
  className,
  children,
}: {
  id: string;
  etiqueta: ReactNode;
  opcional?: boolean;
  ayuda?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  const describidoPor = [idAyuda, idError].filter(Boolean).join(" ") || undefined;
  return (
    <Contexto.Provider value={{ id, describidoPor, invalido: Boolean(error) }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-[13px] font-semibold">
          {etiqueta}
          {opcional && <span className="font-normal text-muted-foreground"> (opcional)</span>}
        </label>
        {children}
        {ayuda && (
          <p id={idAyuda} className="text-xs text-muted-foreground">
            {ayuda}
          </p>
        )}
        {error && (
          <p id={idError} className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    </Contexto.Provider>
  );
}

export function Entrada({ className, ...props }: ComponentProps<"input">) {
  const campo = useContext(Contexto);
  return <input {...props} {...atributosDeCampo(campo, props)} className={cn(CLASE_CONTROL, className)} />;
}

/** Lista desplegable nativa (`<select>`). */
export function Lista({ className, ...props }: ComponentProps<"select">) {
  const campo = useContext(Contexto);
  return <select {...props} {...atributosDeCampo(campo, props)} className={cn(CLASE_CONTROL, "pr-8", className)} />;
}

export function AreaTexto({ className, rows = 2, ...props }: ComponentProps<"textarea">) {
  const campo = useContext(Contexto);
  return (
    <textarea
      {...props}
      rows={rows}
      {...atributosDeCampo(campo, props)}
      className={cn(CLASE_CONTROL, "h-auto min-h-16 py-2", className)}
    />
  );
}

/** Casilla de verificación; con `etiqueta` lleva su texto al lado, sin ella necesita `aria-label`. */
export function Casilla({ etiqueta, className, ...props }: Omit<ComponentProps<"input">, "type"> & { etiqueta?: ReactNode }) {
  const control = (
    <input
      {...props}
      type="checkbox"
      className={cn("size-4 cursor-pointer accent-sucursal disabled:cursor-not-allowed", className)}
    />
  );
  if (!etiqueta) return control;
  return (
    <label className="inline-flex items-center gap-2 text-sm has-disabled:text-muted-foreground">
      {control}
      {etiqueta}
    </label>
  );
}

import type { ReactNode } from "react";

/** La columna de una pantalla: lo de arriba a abajo, con 20 px entre cada cosa. */
export function Pantalla({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>;
}

/**
 * El encabezado de toda pantalla (UI Etapa 1, spec §4.1): título, UNA línea que dice
 * para qué sirve (la principal ayuda de "intuitivo") y el botón principal a la derecha.
 */
export function EncabezadoPantalla({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-titulo text-[28px] leading-tight font-bold">{titulo}</h1>
        {descripcion && <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}

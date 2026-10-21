import type { ReactNode } from "react";

/**
 * La columna de una pantalla: lo de arriba a abajo, con 20 px entre cada cosa. Entra con
 * un desvanecido corto cada vez que se monta, así cambiar de la lista al formulario (o
 * de "Cargando…" a la pantalla) no brinca. Quien cambia de vista con el mismo
 * `<Pantalla>` le pone una `key` distinta para que cuente como vista nueva.
 */
export function Pantalla({ children }: { children: ReactNode }) {
  return <div className="flex animate-in flex-col gap-5 fade-in duration-200 ease-out">{children}</div>;
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

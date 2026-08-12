"use client";

import type { ReactNode } from "react";

export interface Columna<T> {
  encabezado: string;
  celda: (item: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  items: T[];
  columnas: Columna<T>[];
  /** Que decir cuando no hay nada. Cada catalogo lo dice a su manera. */
  vacio: string;
  /** Los botones por fila. Se omite cuando el usuario no puede gestionar. */
  acciones?: (item: T) => ReactNode;
}

/**
 * La tabla que comparten las pantallas de catalogo. Generica sobre `T` para
 * que `celda` reciba el item ya tipado y no un `any`.
 */
export function TablaCatalogo<T extends { id: string }>({
  items,
  columnas,
  vacio,
  acciones,
}: Props<T>) {
  const totalColumnas = columnas.length + (acciones ? 1 : 0);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          {columnas.map((columna) => (
            <th key={columna.encabezado} className="py-2 font-medium">
              {columna.encabezado}
            </th>
          ))}
          {acciones && (
            <th className="py-2">
              <span className="sr-only">Acciones</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b last:border-0">
            {columnas.map((columna) => (
              <td key={columna.encabezado} className={`py-2 ${columna.className ?? ""}`}>
                {columna.celda(item)}
              </td>
            ))}
            {acciones && <td className="py-2 text-right">{acciones(item)}</td>}
          </tr>
        ))}
        {items.length === 0 && (
          <tr>
            <td colSpan={totalColumnas} className="py-4 text-muted-foreground">
              {vacio}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

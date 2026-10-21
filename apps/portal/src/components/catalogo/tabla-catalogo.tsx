"use client";

import type { ReactNode } from "react";
import { Fila, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";

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
 * La tabla que comparten las pantallas de catalogo, armada con la tabla comun
 * (UI Etapa 2). Generica sobre `T` para que `celda` reciba el item ya tipado y
 * no un `any`. La caja (`CajaTabla`) la pone quien la usa.
 */
export function TablaCatalogo<T extends { id: string }>({
  items,
  columnas,
  vacio,
  acciones,
}: Props<T>) {
  const totalColumnas = columnas.length + (acciones ? 1 : 0);

  return (
    <Tabla>
      <thead>
        <tr>
          {columnas.map((columna) => (
            <Th key={columna.encabezado}>{columna.encabezado}</Th>
          ))}
          {acciones && (
            <Th alinear="derecha">
              <span className="sr-only">Acciones</span>
            </Th>
          )}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <Fila key={item.id}>
            {columnas.map((columna) => (
              <Td key={columna.encabezado} className={columna.className}>
                {columna.celda(item)}
              </Td>
            ))}
            {acciones && <Td alinear="derecha">{acciones(item)}</Td>}
          </Fila>
        ))}
        {items.length === 0 && <FilaVacia columnas={totalColumnas}>{vacio}</FilaVacia>}
      </tbody>
    </Tabla>
  );
}

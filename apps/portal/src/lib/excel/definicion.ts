/**
 * Exportacion a Excel reutilizable (T-15). Un reporte describe QUE quiere en
 * la hoja; `construirLibro` decide COMO se ve. Nada aqui sabe de kilometraje.
 */

export type TipoColumna = "texto" | "numero" | "pesos" | "fecha";

export interface ColumnaExcel {
  encabezado: string;
  /** Ancho en caracteres. Sin el, el del encabezado + 2 (minimo 12). */
  ancho?: number;
  tipo: TipoColumna;
  /** Solo para `numero`. Por defecto 0. */
  decimales?: number;
}

/**
 * - `numero` / `pesos`: el numero en la unidad que se ve (km, pesos), no en
 *   decimas ni centavos.
 * - `fecha`: `AAAA-MM-DD`. Cualquier otro texto se escribe tal cual (p. ej.
 *   "Total Nissan-01" en la primera columna de un subtotal).
 */
export type Celda = string | number | null;

export interface FilaExcel {
  celdas: Celda[];
  /** `grupo`: encabezado de un bloque (negrita). `subtotal`/`total`: negrita con borde arriba. */
  tipo?: "normal" | "subtotal" | "total" | "grupo";
  /** Fondo amarillo claro: algo que hay que mirar (p. ej. un salto de kilometraje). */
  resaltada?: boolean;
}

export interface DefinicionExcel {
  /** Fila 1, en negrita. */
  titulo: string;
  /** Una fila cada uno, debajo del titulo: "Rango: 01/10/2026 a 13/10/2026". */
  filtros: Array<[etiqueta: string, valor: string]>;
  columnas: ColumnaExcel[];
  filas: FilaExcel[];
  /** Sin extension. */
  nombreArchivo: string;
}

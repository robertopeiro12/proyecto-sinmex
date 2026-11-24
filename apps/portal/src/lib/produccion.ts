// Lo que queda de la pantalla "Producción del día" (retirada: ahora es la pestaña Entradas
// del Registro de Operación): el Corte sigue leyendo las piezas con `leerPiezas`.

/** El tope que valida el servidor (la columna es `integer`). */
export const MAX_PIEZAS_PRODUCCION = 2_147_483_647;

/**
 * Lo tecleado en una celda → piezas enteras. Vacío = 0 (sin registro); `null` si no es
 * un entero entre 0 y el tope.
 */
export function leerPiezas(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_PIEZAS_PRODUCCION ? n : null;
}

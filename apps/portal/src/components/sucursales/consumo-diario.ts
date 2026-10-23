/**
 * "Consumo propio máximo por día" de la sucursal (T-27 pieza 2, D4): piezas que
 * cada vendedor puede registrar como consumo propio en un día. Entero de 0 a 99
 * (0 lo apaga), el mismo rango que el check de la base y el DTO del backend.
 */
export const AYUDA_CONSUMO_DIARIO = "Piezas que cada vendedor puede registrar como consumo propio en un día.";
export const ERROR_CONSUMO_DIARIO = "Escribe un número entero de 0 a 99.";

/** El texto del campo a número, o `null` si no es un entero de 0 a 99. */
export function leerConsumoDiarioMax(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d{1,2}$/.test(limpio)) return null;
  return Number(limpio);
}

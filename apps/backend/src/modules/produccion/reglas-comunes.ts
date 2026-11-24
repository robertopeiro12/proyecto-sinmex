/**
 * Piezas comunes de las reglas de Produccion (sin base ni Nest): la fecha real
 * del calendario y los mensajes que comparten el corte y el Registro de
 * Operacion. Vivian en `reglas-produccion.ts` (T-25, retirada con el Registro de
 * Operacion); el comportamiento no cambio.
 */

export const MENSAJE_FECHA_INVALIDA = 'La fecha no es válida.';
export const MOTIVO_PRESENTACION_INEXISTENTE =
  'Una de las presentaciones no existe.';
export const MOTIVO_GUARDADO_SIMULTANEO =
  'Otra captura guardó este día al mismo tiempo; vuelve a guardar.';
export const MENSAJE_FECHA_FUTURA = 'La fecha no puede ser posterior a hoy.';
export const MENSAJE_PRESENTACION_REPETIDA = 'Una presentación viene repetida.';

/** `AAAA-MM-DD` y un dia real del calendario (no 2026-02-30). */
export function esFechaReal(fecha: unknown): fecha is string {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha))
    return false;
  const [a, m, d] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return (
    f.getUTCFullYear() === a &&
    f.getUTCMonth() === m - 1 &&
    f.getUTCDate() === d
  );
}

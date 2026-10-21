/**
 * Reglas de la produccion por dia (T-25), sin base ni Nest: validar lo que pide el
 * portal y decidir que filas se crean, se corrigen o se dan de baja. "Hoy en
 * Tijuana" llega de fuera (`hoyEnTijuana`), como en las cargas.
 */

export interface LineaPedida {
  presentacionId: string;
  piezas: number;
}

/** Una fila viva de `produccion` (una por dia, sucursal y presentacion). */
export interface FilaViva {
  id: string;
  presentacionId: string;
  piezas: number;
}

export const MENSAJE_FECHA_INVALIDA = 'La fecha no es válida.';
export const MENSAJE_FECHA_FUTURA = 'La fecha no puede ser posterior a hoy.';
export const MENSAJE_PIEZAS_INVALIDAS =
  'Las piezas deben ser un número entero mayor o igual a 0.';
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

/** Mensajes de error del dia pedido; `[]` = valido. */
export function validarDia(
  entrada: { fecha: string; lineas: LineaPedida[] },
  hoyTijuana: string,
): string[] {
  const mensajes: string[] = [];

  if (!esFechaReal(entrada.fecha)) {
    mensajes.push(MENSAJE_FECHA_INVALIDA);
  } else if (entrada.fecha > hoyTijuana) {
    mensajes.push(MENSAJE_FECHA_FUTURA);
  }

  if (
    entrada.lineas.some(
      (l) =>
        typeof l.piezas !== 'number' ||
        !Number.isInteger(l.piezas) ||
        l.piezas < 0,
    )
  ) {
    mensajes.push(MENSAJE_PIEZAS_INVALIDAS);
  }

  const ids = entrada.lineas.map((l) => l.presentacionId);
  if (new Set(ids).size !== ids.length) {
    mensajes.push(MENSAJE_PRESENTACION_REPETIDA);
  }

  return mensajes;
}

/**
 * Compara lo vivo con lo pedido. 0 piezas o ausente = sin registro: la fila viva
 * se da de baja (no queda una fila con 0) y un 0 sin fila no hace nada.
 */
export function planDelDia(
  vivas: FilaViva[],
  pedidas: LineaPedida[],
): {
  crear: LineaPedida[];
  actualizar: { id: string; piezas: number }[];
  borrar: string[];
} {
  const piezasPedidas = new Map(
    pedidas.map((l) => [l.presentacionId, l.piezas]),
  );
  const vivasPorPresentacion = new Map(vivas.map((f) => [f.presentacionId, f]));

  const crear = pedidas.filter(
    (l) => l.piezas > 0 && !vivasPorPresentacion.has(l.presentacionId),
  );
  const actualizar: { id: string; piezas: number }[] = [];
  const borrar: string[] = [];

  for (const fila of vivas) {
    const piezas = piezasPedidas.get(fila.presentacionId) ?? 0;
    if (piezas === 0) borrar.push(fila.id);
    else if (piezas !== fila.piezas) actualizar.push({ id: fila.id, piezas });
  }

  return { crear, actualizar, borrar };
}

import type { Migracion } from './motor';

/**
 * Rediseno pieza 3 (Inventario): la carga se acepta **por renglon**. Cada
 * renglon guarda si el vendedor lo acepto: 1, 0 o nulo.
 *
 * - Nulo mientras la carga esta pendiente, y en los renglones de antes de esta
 *   migracion: en una carga `aceptada` cuentan como aceptados, en una
 *   `rechazada` como no aceptados (la misma regla del contrato).
 * - Sin `check` y sin rellenar: la escribe solo el pull (y la respuesta del
 *   servidor), que la vuelve 1/0/nulo; mismo criterio que `carga.estado`.
 */
export const cargaRenglon: Migracion = {
  version: 21,
  nombre: 'carga-renglon',
  sql: `
    alter table carga_detalle add column aceptada integer;
  `,
};

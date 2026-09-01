/**
 * El PATCH/POST de cliente recibe el estado COMPLETO de la promocion (D4 del
 * spec), no una secuencia de operaciones: que promocion tiene y que
 * productos selecciono. Esta funcion compara eso contra lo que hay guardado
 * y devuelve el plan a ejecutar contra `cliente_promocion_producto`.
 *
 * Es pura a proposito, igual que `reconciliar-presentaciones.ts` de T-10: no
 * necesita base de datos para probarse.
 */

export type Promocion = 'ninguna' | '10+1' | '20+1';

export interface PlanPromocionProductos {
  insertar: string[];
  eliminar: string[];
}

export function reconciliarPromocionProductos(
  promocion: Promocion,
  existentes: string[],
  pedidos: string[],
): PlanPromocionProductos {
  // Sin promocion, el formulario puede seguir mandando ids sueltos de un
  // guardado anterior (el usuario cambio el desplegable pero no toco los
  // checkboxes) -- se ignoran (D4): la promocion "ninguna" nunca deja
  // productos asociados.
  const efectivos = promocion === 'ninguna' ? [] : Array.from(new Set(pedidos));

  const existentesSet = new Set(existentes);
  const efectivosSet = new Set(efectivos);

  return {
    insertar: efectivos.filter((id) => !existentesSet.has(id)),
    eliminar: existentes.filter((id) => !efectivosSet.has(id)),
  };
}

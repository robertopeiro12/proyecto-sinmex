/**
 * Los tres tipos de egreso (T-30, D1). Fijos: el cliente dijo que "ya deben de
 * venir grabados", asi que no se crean desde la app ni el portal. En la base
 * son el check `ck_campo_egreso_tipo` (y `ck_gasto_tipo`), no una tabla.
 */
export const TIPOS_EGRESO = ['produccion', 'operacion', 'financiero'] as const;

export type TipoEgreso = (typeof TIPOS_EGRESO)[number];

/**
 * El unico metodo de un gasto de la ruta (D4): sale del efectivo que cobro el
 * vendedor ese dia. El siguiente ticket (compras de oficina) amplia el check.
 */
export const METODO_GASTO_RUTA = 'efectivo_cobranza_dia' as const;

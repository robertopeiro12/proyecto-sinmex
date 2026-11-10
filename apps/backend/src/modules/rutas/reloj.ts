/**
 * El reloj con el que las rutas deciden "hoy" (de Tijuana, con
 * `hoyEnTijuana`). Es un proveedor para que una prueba lo fije, por ejemplo a
 * las 23:30 de Tijuana, cuando en UTC ya es el dia siguiente.
 */
export const RELOJ_RUTAS = Symbol('RELOJ_RUTAS');

export type RelojRutas = () => Date;

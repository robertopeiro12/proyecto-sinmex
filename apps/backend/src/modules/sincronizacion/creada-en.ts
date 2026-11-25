/**
 * El `creada_en` del detalle de una nota del pull (rediseño pieza 7; recorrido
 * final, D2): la hora de la venta en la tablet (`ocurrido_en` mas antiguo de
 * `sync_operacion`) como ISO-8601 en UTC. Una nota sin operacion (la registro
 * la oficina) no tiene hora de venta: viaja **solo su fecha** (`YYYY-MM-DD`),
 * no la hora de captura en el portal, y el ticket imprime solo el dia.
 */
export function creadaEnDelDetalle(
  ocurridoEn: Date | string | null,
  fecha: string,
): string {
  return ocurridoEn === null ? fecha : new Date(ocurridoEn).toISOString();
}

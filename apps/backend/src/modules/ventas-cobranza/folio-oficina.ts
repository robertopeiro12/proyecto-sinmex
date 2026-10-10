import {
  MAX_OPERACIONES_POR_DIA,
  SEGMENTO_OFICINA,
  formarFolio,
} from '../sincronizacion/folio';

/**
 * El folio de una venta registrada en el portal (T-17, §4.4 del spec).
 *
 * > [!info] Enmienda a ADR-0001/0007 (ADR nuevo en el vault)
 * > Los folios de la tablet los sigue emitiendo la tablet, offline. Los del
 * > portal los emite el SERVIDOR, que si tiene red y una sola fuente de verdad
 * > (`folio_oficina_contador`). El segmento de vendedor es `OF` siempre, aunque
 * > la venta quede a nombre de un vendedor: el folio identifica quien la
 * > EMITIO, y la emitio la oficina.
 *
 * La fecha es la de la VENTA, no la de captura: una venta de la semana pasada
 * lleva la fecha de la semana pasada, con su propio contador.
 */
export function folioDeOficina(
  codigoSucursal: string,
  fecha: string,
  consecutivo: number,
): string {
  if (
    !Number.isInteger(consecutivo) ||
    consecutivo < 1 ||
    consecutivo > MAX_OPERACIONES_POR_DIA
  ) {
    throw new RangeError(
      `Consecutivo de folio de oficina fuera de 1..${MAX_OPERACIONES_POR_DIA}: ${consecutivo}`,
    );
  }
  return formarFolio(codigoSucursal, fecha, SEGMENTO_OFICINA, consecutivo);
}

/**
 * La sucursal ya emitio 99 folios de oficina para ese dia: el formato no tiene
 * un numero 100 (ADR-0001). Quien llama lo traduce a 409.
 */
export class FoliosOficinaAgotados extends Error {
  constructor(readonly fecha: string) {
    super(
      `Se alcanzó el máximo de ${MAX_OPERACIONES_POR_DIA} ventas de oficina para ese día.`,
    );
    this.name = 'FoliosOficinaAgotados';
  }
}

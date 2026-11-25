import type { Venta } from '@/datos/tipos';

/**
 * La firma del cliente en la nota (T-73). Desde el rediseno pieza 2 la venta ya
 * no la captura (el cliente firma a mano la nota impresa); queda solo lo que
 * sirve a las ventas viejas que aun guardan una imagen por subir (la cola la
 * sube con `fuenteFirmasVentas`).
 */

/** "Firma por subir" en la ficha: hay firma, el servidor aun no la tiene y no se dio por perdida. */
export function firmaPorSubir(
  v: Pick<Venta, 'firma_local' | 'firma_subida_en' | 'firma_descartada'>,
): boolean {
  return v.firma_local !== null && v.firma_subida_en === null && v.firma_descartada === 0;
}

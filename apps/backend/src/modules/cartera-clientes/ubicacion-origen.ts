/**
 * De donde salio la coordenada de un cliente (T-72, D3), y que origen se guarda
 * cuando el portal manda latitud y longitud.
 *
 * Puro, sin base de datos. La base lo hace cumplir con dos checks
 * (`ck_cliente_ubicacion_origen_valor`, `ck_cliente_ubicacion_origen_con_lat`):
 * nulo si y solo si no hay `lat`.
 */
export type OrigenUbicacion = 'gps' | 'geocodificada' | 'manual';

/** La coordenada que ya tiene el cliente, con su origen. */
export interface UbicacionActual {
  lat: number | null;
  lng: number | null;
  ubicacionOrigen: OrigenUbicacion | null;
}

/**
 * El origen que se guarda con un alta o una edicion del portal.
 *
 * - Sin `lat` no hay coordenada: `null` (borrar la coordenada borra su origen).
 * - La MISMA coordenada que ya tenia conserva su origen. El formulario del
 *   portal manda siempre la ficha completa (`EditarClienteDto`), asi que guardar
 *   sin tocar la ubicacion reenvia la de Google o la del GPS; si eso la volviera
 *   `'manual'`, cada edicion borraria de donde salio.
 * - Cualquier otra coordenada la capturo la oficina: `'manual'`.
 *
 * `actual` es `null` en un alta.
 */
export function origenAlGuardar(
  nueva: { lat: number | null; lng: number | null },
  actual: UbicacionActual | null,
): OrigenUbicacion | null {
  if (nueva.lat === null) return null;
  if (
    actual !== null &&
    actual.ubicacionOrigen !== null &&
    actual.lat === nueva.lat &&
    actual.lng === nueva.lng
  ) {
    return actual.ubicacionOrigen;
  }
  return 'manual';
}

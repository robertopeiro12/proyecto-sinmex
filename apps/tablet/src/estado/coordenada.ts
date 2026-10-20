/**
 * ¿Es una lectura del GPS que se puede guardar? (T-39 D7, T-72 D1)
 *
 * Una coordenada fuera de rango o no finita cuenta como "sin GPS": la pantalla
 * pide la direccion y se guarda con `lat`/`lng` en null. Vive aqui una sola vez
 * para que la visita y el alta de prospecto no puedan discrepar.
 */
export function esCoordenadaValida(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

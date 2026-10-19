/**
 * Los topes de la firma del cliente (T-73) que comparten la pantalla y el
 * repositorio de ventas.
 *
 * Viven en `src/datos/` (como `reglas-gasto.ts`) porque el repositorio los
 * vuelve a comprobar antes de abrir la transaccion, y `src/datos/` no importa de
 * `src/estado/`. `src/estado/firma.ts` los reexporta para la pantalla.
 *
 * El mismo 80 esta en `datos-venta.ts` del servidor y en el check de
 * `venta_nota.firma_nombre`: si cambia uno, cambian los tres.
 */
export const LARGO_MAX_NOMBRE_FIRMA = 80;

/**
 * Lo unico que el repositorio graba como nombre de quien firma: `null` o un
 * texto YA recortado de 1 a 80 caracteres (`normalizarNombreFirma` de la
 * pantalla lo deja asi).
 */
export function nombreFirmaValido(nombre: string | null): boolean {
  return (
    nombre === null ||
    (nombre === nombre.trim() && nombre.length >= 1 && nombre.length <= LARGO_MAX_NOMBRE_FIRMA)
  );
}

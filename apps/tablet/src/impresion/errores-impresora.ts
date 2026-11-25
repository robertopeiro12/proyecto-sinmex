/**
 * Los rechazos del modulo nativo `ImpresoraBluetooth` (su `code`) vueltos texto
 * para el vendedor. Puro: no importa el modulo (que trae `expo`), solo su tipo.
 */
import type { CodigoErrorImpresora } from '../../modules/impresora-bluetooth/src/ImpresoraBluetooth.types';

export const SIN_IMPRESORA = 'Elige la impresora en Seleccionar impresora.';
export const SIN_BLUETOOTH = 'Este equipo no tiene Bluetooth disponible.';

const CODIGOS: readonly CodigoErrorImpresora[] = [
  'sin-bluetooth',
  'bluetooth-apagado',
  'sin-permiso',
  'no-conecta',
  'fallo-envio',
];

/** El `code` del error si es uno del modulo; si no, `null`. */
export function codigoDeError(e: unknown): CodigoErrorImpresora | null {
  if (typeof e !== 'object' || e === null) return null;
  const code = (e as { code?: unknown }).code;
  return CODIGOS.find((c) => c === code) ?? null;
}

/** `nombre`: el de la impresora, para los errores que la nombran. */
export function textoErrorImpresora(code: string | null, nombre: string): string {
  switch (code) {
    case 'sin-bluetooth':
      return SIN_BLUETOOTH;
    case 'bluetooth-apagado':
      return 'Prende el Bluetooth.';
    case 'sin-permiso':
      return 'Da permiso de Bluetooth a la app.';
    case 'no-conecta':
      return `No se pudo conectar con ${nombre}. ¿Está prendida?`;
    case 'fallo-envio':
      return `Se cortó la conexión con ${nombre} al mandar la nota. Revisa el papel y vuelve a intentar.`;
    default:
      return `No se pudo imprimir en ${nombre}.`;
  }
}

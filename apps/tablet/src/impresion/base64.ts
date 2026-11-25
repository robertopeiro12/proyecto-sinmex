/**
 * Base64 estándar (con relleno `=`) de un arreglo de bytes. Así cruzan los
 * bytes ESC/POS hacia el módulo nativo de la impresora: ni React Native ni
 * Hermes garantizan `Buffer` ni `btoa` (ver `seguridad/bytes.ts`).
 */
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function aBase64(bytes: Uint8Array): string {
  let salida = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const restantes = bytes.length - i;
    salida += ALFABETO[a >> 2];
    salida += ALFABETO[((a & 0x03) << 4) | (b >> 4)];
    salida += restantes > 1 ? ALFABETO[((b & 0x0f) << 2) | (c >> 6)] : '=';
    salida += restantes > 2 ? ALFABETO[c & 0x3f] : '=';
  }
  return salida;
}

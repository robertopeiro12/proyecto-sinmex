/**
 * Conversiones de bytes sin dependencias.
 *
 * Ni React Native ni Hermes garantizan `TextEncoder`, `Buffer`, `btoa` ni
 * `atob` de forma estable entre versiones del SDK, y esta capa la usa el
 * verificador de la contrasena: si un dia una de esas globales desaparece, el
 * vendedor no podria entrar a su app en ruta. Son treinta lineas; se escriben
 * aqui y se prueban en Node.
 *
 * Se usa **hex** y no base64 a proposito: es trivial de implementar en ambos
 * sentidos, no tiene relleno ni variantes (`base64` vs `base64url`) y el
 * verificador se guarda en `expo-secure-store`, donde el tamano del texto no
 * es un problema (64 caracteres por cada 32 bytes).
 */

/** Codifica texto a UTF-8. Equivalente a `new TextEncoder().encode()`. */
export function bytesDeTexto(texto: string): Uint8Array {
  const salida: number[] = [];

  for (let i = 0; i < texto.length; i++) {
    let punto = texto.charCodeAt(i);

    // Par suplente (emoji, etc.): se combinan las dos unidades UTF-16 en un
    // solo punto de codigo antes de codificar.
    if (punto >= 0xd800 && punto <= 0xdbff && i + 1 < texto.length) {
      const siguiente = texto.charCodeAt(i + 1);
      if (siguiente >= 0xdc00 && siguiente <= 0xdfff) {
        punto = ((punto - 0xd800) << 10) + (siguiente - 0xdc00) + 0x10000;
        i++;
      }
    }

    if (punto < 0x80) {
      salida.push(punto);
    } else if (punto < 0x800) {
      salida.push(0xc0 | (punto >> 6), 0x80 | (punto & 0x3f));
    } else if (punto < 0x10000) {
      salida.push(0xe0 | (punto >> 12), 0x80 | ((punto >> 6) & 0x3f), 0x80 | (punto & 0x3f));
    } else {
      salida.push(
        0xf0 | (punto >> 18),
        0x80 | ((punto >> 12) & 0x3f),
        0x80 | ((punto >> 6) & 0x3f),
        0x80 | (punto & 0x3f),
      );
    }
  }

  return Uint8Array.from(salida);
}

export function hexDeBytes(bytes: Uint8Array): string {
  let salida = '';
  for (const byte of bytes) {
    salida += byte.toString(16).padStart(2, '0');
  }
  return salida;
}

export function bytesDeHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error('Cadena hexadecimal invalida.');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Comparacion en **tiempo constante** respecto al contenido.
 *
 * Un `===` sobre las cadenas hex corta en el primer byte distinto, y esa
 * diferencia de tiempo es medible: convierte "adivinar la contrasena" en
 * "adivinar byte por byte". Aqui siempre se recorren los dos arreglos enteros
 * y se acumula la diferencia con OR.
 *
 * La longitud si se filtra (no hay forma de evitarlo sin hashear otra vez), y
 * no importa: la longitud del hash es publica y fija.
 */
export function igualesEnTiempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) {
    diferencia |= (a[i] as number) ^ (b[i] as number);
  }
  return diferencia === 0;
}

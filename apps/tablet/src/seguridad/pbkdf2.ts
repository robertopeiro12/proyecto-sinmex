/**
 * HMAC-SHA256 y PBKDF2-HMAC-SHA256 (RFC 2104 y RFC 8018) en TypeScript puro.
 *
 * Es el KDF con el que la app deriva el **verificador local** de la contrasena
 * del vendedor, lo unico que permite re-autenticarlo sin red. El porque de
 * implementarlo aqui en vez de usar una libreria nativa esta en `sha256.ts`.
 *
 * Correccion: `pbkdf2.spec.ts` compara esta implementacion contra
 * `node:crypto.pbkdf2Sync` con entradas aleatorias (contrasenas con acentos y
 * emoji, sales de largo variable, iteraciones y longitudes de salida
 * distintas). Si algo aqui se desviara del estandar, esas pruebas lo dicen.
 */
import {
  BLOQUE_BYTES,
  DIGESTO_BYTES,
  comprimirBloque,
  digerirDesde,
  estadoInicial,
  sha256,
} from './sha256';

/**
 * Clave HMAC con los dos estados intermedios ya calculados.
 *
 * HMAC = H(K⊕opad ‖ H(K⊕ipad ‖ mensaje)). Los bloques `K⊕ipad` y `K⊕opad` son
 * de 64 bytes y **no cambian** entre llamadas con la misma clave, asi que su
 * compresion se hace UNA vez. En PBKDF2 con 150 000 iteraciones eso ahorra
 * 600 000 compresiones (la mitad del trabajo total).
 */
interface ClaveHmac {
  interno: Uint32Array;
  externo: Uint32Array;
}

function prepararClave(clave: Uint8Array): ClaveHmac {
  // RFC 2104: una clave mas larga que el bloque se sustituye por su hash.
  const normalizada = clave.length > BLOQUE_BYTES ? sha256(clave) : clave;

  const ipad = new Uint8Array(BLOQUE_BYTES);
  const opad = new Uint8Array(BLOQUE_BYTES);
  for (let i = 0; i < BLOQUE_BYTES; i++) {
    const byte = i < normalizada.length ? (normalizada[i] as number) : 0;
    ipad[i] = byte ^ 0x36;
    opad[i] = byte ^ 0x5c;
  }

  const w = new Uint32Array(64);
  const interno = estadoInicial();
  comprimirBloque(interno, ipad, 0, w);
  const externo = estadoInicial();
  comprimirBloque(externo, opad, 0, w);

  return { interno, externo };
}

function hmacCon(clave: ClaveHmac, mensaje: Uint8Array, w: Uint32Array): Uint8Array {
  const dentro = digerirDesde(clave.interno.slice(), mensaje, BLOQUE_BYTES, w);
  return digerirDesde(clave.externo.slice(), dentro, BLOQUE_BYTES, w);
}

/** HMAC-SHA256 de un mensaje con una clave. */
export function hmacSha256(clave: Uint8Array, mensaje: Uint8Array): Uint8Array {
  return hmacCon(prepararClave(clave), mensaje, new Uint32Array(64));
}

/**
 * PBKDF2-HMAC-SHA256.
 *
 * @param password  Contrasena ya codificada en UTF-8.
 * @param salt      Sal aleatoria (nunca reutilizada entre vendedores).
 * @param iteraciones  Coste. Ver `COSTE_PBKDF2` en `verificador.ts`.
 * @param longitud  Bytes de clave derivada.
 */
export function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iteraciones: number,
  longitud: number,
): Uint8Array {
  if (!Number.isInteger(iteraciones) || iteraciones < 1) {
    throw new Error('Las iteraciones de PBKDF2 deben ser un entero positivo.');
  }
  if (!Number.isInteger(longitud) || longitud < 1) {
    throw new Error('La longitud derivada debe ser un entero positivo.');
  }

  const clave = prepararClave(password);
  const w = new Uint32Array(64);
  const bloques = Math.ceil(longitud / DIGESTO_BYTES);
  const salida = new Uint8Array(bloques * DIGESTO_BYTES);

  // Buffer reusado para `salt ‖ INT_32_BE(indice)`, el mensaje de la primera
  // iteracion de cada bloque.
  const semilla = new Uint8Array(salt.length + 4);
  semilla.set(salt, 0);

  for (let bloque = 1; bloque <= bloques; bloque++) {
    semilla[salt.length] = (bloque >>> 24) & 0xff;
    semilla[salt.length + 1] = (bloque >>> 16) & 0xff;
    semilla[salt.length + 2] = (bloque >>> 8) & 0xff;
    semilla[salt.length + 3] = bloque & 0xff;

    let u = hmacCon(clave, semilla, w);
    const acumulado = u.slice();

    for (let i = 1; i < iteraciones; i++) {
      u = hmacCon(clave, u, w);
      for (let j = 0; j < DIGESTO_BYTES; j++) {
        acumulado[j] = (acumulado[j] as number) ^ (u[j] as number);
      }
    }

    salida.set(acumulado, (bloque - 1) * DIGESTO_BYTES);
  }

  return salida.subarray(0, longitud);
}

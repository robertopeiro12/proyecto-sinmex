import { createHash, randomBytes } from 'node:crypto';

import { bytesDeHex, bytesDeTexto, hexDeBytes, igualesEnTiempoConstante } from './bytes';
import { sha256 } from './sha256';

/**
 * La prueba que de verdad importa es la comparacion contra `node:crypto`: es
 * una implementacion de referencia independiente, y contrastarla con entradas
 * ALEATORIAS cubre los casos frontera que uno no piensa (longitudes justo en
 * el limite de bloque, mensajes que necesitan un bloque extra de relleno).
 *
 * Un par de vectores fijos no bastaria: una implementacion puede acertar el
 * hash de "abc" y equivocarse en el relleno de 55/56/64 bytes, que es
 * exactamente donde fallan estas cosas.
 */
describe('sha256', () => {
  it('coincide con node:crypto en los vectores clasicos de FIPS 180-4', () => {
    expect(hexDeBytes(sha256(bytesDeTexto('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hexDeBytes(sha256(bytesDeTexto('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('coincide con node:crypto en TODAS las longitudes de 0 a 200 bytes', () => {
    // El barrido exhaustivo cubre los tres casos de relleno: cabe en el bloque,
    // no cabe la longitud de 8 bytes y hace falta un bloque extra, y el mensaje
    // es multiplo exacto de 64.
    for (let n = 0; n <= 200; n++) {
      const datos = randomBytes(n);
      const esperado = createHash('sha256').update(datos).digest('hex');
      expect(hexDeBytes(sha256(new Uint8Array(datos)))).toBe(esperado);
    }
  });

  it('coincide con node:crypto para mensajes largos (varios bloques)', () => {
    for (const n of [1000, 4096, 100_000]) {
      const datos = randomBytes(n);
      expect(hexDeBytes(sha256(new Uint8Array(datos)))).toBe(
        createHash('sha256').update(datos).digest('hex'),
      );
    }
  });
});

describe('bytesDeTexto', () => {
  it('codifica UTF-8 igual que Buffer, incluyendo acentos y emoji', () => {
    // La contrasena de un vendedor mexicano llevara acentos y enes; si la
    // codificacion difiriera de la del servidor, el mismo texto produciria
    // hashes distintos y el login offline fallaria solo para esos usuarios.
    for (const texto of ['', 'abc', 'contrasena', 'contraseña', 'Ñandú áéíóú', '🚚 ruta', '€¥£']) {
      expect(hexDeBytes(bytesDeTexto(texto))).toBe(Buffer.from(texto, 'utf8').toString('hex'));
    }
  });
});

describe('hex', () => {
  it('ida y vuelta', () => {
    const datos = new Uint8Array(randomBytes(64));
    expect(bytesDeHex(hexDeBytes(datos))).toEqual(datos);
  });

  it('rechaza cadenas que no son hexadecimales', () => {
    expect(() => bytesDeHex('abc')).toThrow();
    expect(() => bytesDeHex('zz')).toThrow();
  });
});

describe('igualesEnTiempoConstante', () => {
  it('distingue contenido y longitud', () => {
    expect(igualesEnTiempoConstante(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(
      true,
    );
    expect(igualesEnTiempoConstante(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(
      false,
    );
    expect(igualesEnTiempoConstante(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('detecta una diferencia en el ULTIMO byte, no solo en el primero', () => {
    // Una comparacion que cortara antes de tiempo seguiria pasando el caso de
    // arriba; este obliga a recorrer el arreglo completo.
    const a = new Uint8Array(32).fill(7);
    const b = new Uint8Array(32).fill(7);
    b[31] = 8;
    expect(igualesEnTiempoConstante(a, b)).toBe(false);
  });
});

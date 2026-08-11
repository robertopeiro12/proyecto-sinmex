import { createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

import { bytesDeTexto, hexDeBytes } from './bytes';
import { hmacSha256, pbkdf2Sha256 } from './pbkdf2';
import { COSTE_PBKDF2 } from './verificador';

describe('hmacSha256', () => {
  it('coincide con node:crypto para claves cortas, del tamano del bloque y mas largas', () => {
    // Las tres ramas de RFC 2104: clave < 64 bytes (se rellena con ceros),
    // clave == 64 (se usa tal cual) y clave > 64 (se sustituye por su hash).
    // La tercera es la que se olvida y la que rompe la interoperabilidad.
    for (const largoClave of [1, 16, 32, 63, 64, 65, 100, 200]) {
      const clave = randomBytes(largoClave);
      const mensaje = randomBytes(137);
      expect(hexDeBytes(hmacSha256(new Uint8Array(clave), new Uint8Array(mensaje)))).toBe(
        createHmac('sha256', clave).update(mensaje).digest('hex'),
      );
    }
  });
});

describe('pbkdf2Sha256', () => {
  it('reproduce el vector conocido de PBKDF2-HMAC-SHA256', () => {
    // Vector ampliamente citado (password="password", salt="salt", c=1).
    expect(hexDeBytes(pbkdf2Sha256(bytesDeTexto('password'), bytesDeTexto('salt'), 1, 32))).toBe(
      '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
    );
    expect(hexDeBytes(pbkdf2Sha256(bytesDeTexto('password'), bytesDeTexto('salt'), 2, 32))).toBe(
      'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43',
    );
  });

  /**
   * Esta es la prueba autoritativa del modulo.
   *
   * Contrasta contra la implementacion de referencia de Node con entradas
   * aleatorias y variando TODOS los parametros a la vez: contrasenas con
   * acentos y emoji (donde falla una codificacion UTF-8 mal hecha), sales de
   * largo variable, y longitudes de salida mayores que 32 bytes (donde falla
   * el bucle de bloques, que con la longitud "normal" de 32 nunca se ejercita).
   */
  it('coincide con node:crypto.pbkdf2Sync con parametros aleatorios', () => {
    const contrasenas = ['', 'x', 'contraseña-del-vendedor', 'ñÁÉ 123', '🚚🧊', 'a'.repeat(200)];

    for (const password of contrasenas) {
      for (const largoSal of [1, 8, 16, 33]) {
        for (const longitud of [16, 32, 33, 64, 100]) {
          const sal = randomBytes(largoSal);
          const iteraciones = 1 + Math.floor(Math.random() * 50);

          const nuestro = pbkdf2Sha256(bytesDeTexto(password), new Uint8Array(sal), iteraciones, longitud);
          const referencia = pbkdf2Sync(
            Buffer.from(password, 'utf8'),
            sal,
            iteraciones,
            longitud,
            'sha256',
          );

          expect(hexDeBytes(nuestro)).toBe(referencia.toString('hex'));
        }
      }
    }
  });

  it('rechaza parametros invalidos en vez de derivar algo debil en silencio', () => {
    const p = bytesDeTexto('x');
    const s = bytesDeTexto('y');
    expect(() => pbkdf2Sha256(p, s, 0, 32)).toThrow();
    expect(() => pbkdf2Sha256(p, s, -1, 32)).toThrow();
    expect(() => pbkdf2Sha256(p, s, 1.5, 32)).toThrow();
    expect(() => pbkdf2Sha256(p, s, 1, 0)).toThrow();
  });

  it('el coste real de COSTE_PBKDF2 queda registrado (referencia, no umbral)', () => {
    const inicio = Date.now();
    pbkdf2Sha256(bytesDeTexto('contrasena-de-prueba'), randomBytes(16), COSTE_PBKDF2, 32);
    const ms = Date.now() - inicio;

    // NO se afirma un umbral de tiempo: seria una prueba inestable (depende de
    // la maquina de CI). Se imprime para dejar constancia del orden de
    // magnitud EN NODE. En Hermes sobre una tablet Android sera bastante mas
    // lento y esta sin medir: ver la advertencia de COSTE_PBKDF2.
    console.log(`PBKDF2 ${COSTE_PBKDF2} iteraciones en Node: ${ms} ms`);
    expect(ms).toBeGreaterThan(0);
  });
});

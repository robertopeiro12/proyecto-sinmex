import type { ConfigService } from '@nestjs/config';
import { opcionesCookie } from './cookies';

/**
 * opcionesCookie() debe devolver `secure: true` sin importar de que mundo
 * venga COOKIE_SECURE:
 *
 * - Con el `validationSchema` de AppModule activo, @nestjs/config devuelve el
 *   valor YA CONVERTIDO por Joi: un booleano.
 * - Sin ese schema (AuthModule montado suelto, como en algunas pruebas
 *   unitarias), el valor llega tal cual del entorno: una cadena.
 *
 * Comparar solo contra la cadena 'true' (`=== 'true'`) es exactamente el bug
 * que casi se filtro: el booleano `true` daba `false`, y las cookies de
 * sesion se emitirian sin `Secure` en produccion sin que nada fallara. Este
 * test fija las tres formas en que COOKIE_SECURE puede llegar.
 */
describe('opcionesCookie - flag Secure', () => {
  const construirConfig = (valorCookieSecure: unknown): ConfigService =>
    ({
      get: (clave: string, valorPorDefecto?: unknown) => {
        if (clave === 'COOKIE_SECURE') {
          return valorCookieSecure;
        }
        if (clave === 'COOKIE_SAMESITE') {
          return valorPorDefecto ?? 'lax';
        }
        if (clave === 'COOKIE_DOMAIN') {
          return undefined;
        }
        return valorPorDefecto;
      },
    }) as unknown as ConfigService;

  it('COOKIE_SECURE=true (booleano, mundo con schema validado) => secure: true', () => {
    const opciones = opcionesCookie(construirConfig(true), 1000);
    expect(opciones.secure).toBe(true);
  });

  it("COOKIE_SECURE='true' (cadena, mundo sin schema) => secure: true", () => {
    const opciones = opcionesCookie(construirConfig('true'), 1000);
    expect(opciones.secure).toBe(true);
  });

  it('COOKIE_SECURE ausente/false => secure: false', () => {
    expect(opcionesCookie(construirConfig(false), 1000).secure).toBe(false);
    expect(opcionesCookie(construirConfig(undefined), 1000).secure).toBe(false);
  });
});

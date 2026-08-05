import type { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';

export const COOKIE_ACCESO = 'jawa_access';
export const COOKIE_REFRESH = 'jawa_refresh';

/**
 * httpOnly siempre: el JS del portal nunca debe poder leer estos valores.
 * En produccion portal y API deben compartir dominio padre (COOKIE_DOMAIN).
 */
export function opcionesCookie(
  config: ConfigService,
  maxAgeMs: number,
): CookieOptions {
  const dominio = config.get<string>('COOKIE_DOMAIN');
  return {
    httpOnly: true,
    secure: esVerdadero(config.get('COOKIE_SECURE')),
    // El valor ya viene restringido a 'lax' | 'strict' por
    // configuracion.schema.ts; 'none' no es aceptable porque apagaria la
    // unica defensa contra CSRF del sistema. El cast solo estrecha el tipo.
    sameSite: config.get<string>(
      'COOKIE_SAMESITE',
      'lax',
    ) as CookieOptions['sameSite'],
    domain: dominio && dominio.length > 0 ? dominio : undefined,
    path: '/',
    maxAge: maxAgeMs,
  };
}

/**
 * COOKIE_SECURE llega como booleano cuando el schema de AppModule esta activo
 * (Joi convierte) y como cadena cuando no lo esta (pruebas unitarias, o
 * AuthModule montado suelto). Comparar solo contra la cadena 'true' hacia que
 * el booleano `true` diera `false`: las cookies se emitirian SIN Secure en
 * produccion sin que nada avisara. De ahi que se contemplen las dos formas.
 */
function esVerdadero(valor: unknown): boolean {
  return valor === true || valor === 'true';
}

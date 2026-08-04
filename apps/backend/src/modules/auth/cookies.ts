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
    secure: config.get<string>('COOKIE_SECURE', 'false') === 'true',
    sameSite: config.get<string>(
      'COOKIE_SAMESITE',
      'lax',
    ) as CookieOptions['sameSite'],
    domain: dominio && dominio.length > 0 ? dominio : undefined,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function msDeHoras(horas: number): number {
  return horas * 60 * 60 * 1000;
}

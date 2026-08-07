import { createHash } from 'node:crypto';

/**
 * Hash con el que se guardan los refresh tokens (portal y app).
 *
 * SHA-256, no argon2: el token ya son 32 bytes aleatorios (no hay entropia baja
 * que proteger) y la busqueda por igualdad debe ser barata.
 *
 * Vive aqui, y no en cada servicio, porque lo comparten `TokenService` (portal)
 * y `TokenVendedorService` (app): si cada uno tuviera su copia, cambiar el
 * algoritmo en uno solo dejaria al otro guardando tokens con un formato que
 * nadie volveria a encontrar — y el sintoma seria "las sesiones no funcionan",
 * sin ningun error.
 */
export function hashearToken(plano: string): string {
  return createHash('sha256').update(plano).digest('hex');
}

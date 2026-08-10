import { esquemaInicial } from './001-esquema-inicial';
import { sincronizacion } from './002-sincronizacion';
import { folios } from './003-folios';
import type { Migracion } from './motor';

/**
 * Catalogo de migraciones locales, **en orden y sin huecos**.
 *
 * Reglas para los tickets que vienen:
 * 1. Una migracion ya publicada **no se edita**: hay tablets en la calle con
 *    ese esquema aplicado. Se agrega una nueva.
 * 2. La version es el indice + 1 (`motor.ts` lo valida al arrancar).
 * 3. El archivo se nombra `NNN-descripcion.ts` para que ordene solo.
 */
export const migraciones: readonly Migracion[] = [
  esquemaInicial,
  sincronizacion,
  folios,
];

export { ejecutarMigraciones, versionEsquema } from './motor';
export type { Migracion, ResultadoMigraciones } from './motor';

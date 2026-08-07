import type { BaseDatos } from '../base-datos';
import type { Reloj } from '../reloj';

/**
 * Dependencias que recibe cualquier repositorio.
 *
 * Se inyectan (en vez de importarse) por dos razones concretas:
 * - `bd` puede ser el driver de expo-sqlite (tablet) o el de better-sqlite3
 *   (pruebas en Node);
 * - `reloj` y `generarId` son las dos fuentes de no-determinismo de esta capa,
 *   y las pruebas necesitan fijarlas.
 */
export interface DepsRepositorio {
  bd: BaseDatos;
  reloj: Reloj;
  /** Genera el identificador de una fila que nace en la tablet (uuid v4). */
  generarId: () => string;
}

/** Ejecuta `tarea` dentro de una transaccion, revirtiendo si algo falla. */
export function enTransaccion<T>(bd: BaseDatos, tarea: () => T): T {
  bd.execSync('begin;');
  try {
    const resultado = tarea();
    bd.execSync('commit;');
    return resultado;
  } catch (error) {
    bd.execSync('rollback;');
    throw error;
  }
}

import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import type { BaseDatos, ParametrosSQL, ResultadoEscritura } from './base-datos';

/** Nombre del archivo SQLite en el almacenamiento de la tablet. */
export const NOMBRE_BD = 'jawa.db';

/**
 * Adapta el `SQLiteDatabase` de expo-sqlite a la interfaz {@link BaseDatos}.
 *
 * Es un envoltorio explicito (y no un cast estructural) a proposito: las firmas
 * de expo-sqlite estan sobrecargadas con variadic params y un cast se romperia
 * en silencio si la libreria cambia una de las sobrecargas.
 */
export function adaptarExpoSQLite(bd: SQLiteDatabase): BaseDatos {
  return {
    execSync(sql: string): void {
      bd.execSync(sql);
    },
    runSync(sql: string, params: ParametrosSQL = []): ResultadoEscritura {
      const { lastInsertRowId, changes } = bd.runSync(sql, params);
      return { lastInsertRowId, changes };
    },
    getFirstSync<T>(sql: string, params: ParametrosSQL = []): T | null {
      return bd.getFirstSync<T>(sql, params);
    },
    getAllSync<T>(sql: string, params: ParametrosSQL = []): T[] {
      return bd.getAllSync<T>(sql, params);
    },
  };
}

/**
 * Abre (creando si hace falta) la base local de la tablet.
 *
 * `foreign_keys` y el modo WAL se activan aqui y no en una migracion porque son
 * ajustes **de conexion**, no de esquema: SQLite los olvida al cerrar.
 */
export function abrirBaseDatos(nombre: string = NOMBRE_BD): BaseDatos {
  const bd = adaptarExpoSQLite(openDatabaseSync(nombre));
  bd.execSync('pragma journal_mode = WAL;');
  bd.execSync('pragma foreign_keys = ON;');
  return bd;
}

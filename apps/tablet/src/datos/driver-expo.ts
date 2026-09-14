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
 * `foreign_keys`, el modo WAL y `synchronous` se activan aqui y no en una
 * migracion porque son ajustes **de conexion**, no de esquema: SQLite los
 * olvida al cerrar.
 *
 * > [!warning] `synchronous = FULL`: durabilidad ante corte de corriente, no
 * > solo ante caida de la app
 * > El equipo es el celular **personal** del vendedor, en ruta ~12 h, y el
 * > cliente exige que la jornada capturada no se pierda si se queda sin pila
 * > (ver ADR-0010 en el vault). En WAL, `synchronous = NORMAL` hace que un
 * > commit sobreviva a que la app se caiga, pero **no** garantiza que
 * > sobreviva a que el equipo se apague de golpe — que es exactamente el caso de la pila agotada: sin un `fsync` del
 * > archivo WAL antes de confirmar, una pagina puede quedarse solo en la
 * > cache del sistema operativo. `synchronous = FULL` fuerza ese `fsync` en
 * > cada commit. El costo es una escritura a disco por operacion, irrelevante
 * > frente a la cadencia real de captura de un vendedor.
 * >
 * > **Por que fijarlo y no confiar en el default:** SQLite documenta `FULL`
 * > como default, pero se compila con `SQLITE_DEFAULT_WAL_SYNCHRONOUS` y
 * > muchas builds lo bajan a `NORMAL` en modo WAL. Cual de los dos aplica
 * > depende de como se compilo SQLite dentro de `expo-sqlite`, y eso puede
 * > cambiar entre versiones de la libreria sin que nadie se entere. Con un
 * > requisito del cliente encima, la durabilidad no se deja al azar de una
 * > bandera de compilacion ajena.
 */
export function abrirBaseDatos(nombre: string = NOMBRE_BD): BaseDatos {
  const bd = adaptarExpoSQLite(openDatabaseSync(nombre));
  bd.execSync('pragma journal_mode = WAL;');
  bd.execSync('pragma foreign_keys = ON;');
  bd.execSync('pragma synchronous = FULL;');
  return bd;
}

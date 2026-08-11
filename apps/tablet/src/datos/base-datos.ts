/**
 * Interfaz minima de acceso a SQLite.
 *
 * Es un subconjunto de la API **sincrona** de `expo-sqlite`
 * (`openDatabaseSync()` -> `SQLiteDatabase`). Todo lo que hay debajo de
 * `src/datos/` (migraciones y repositorios) depende de ESTA interfaz y nunca
 * de `expo-sqlite` directamente. Gracias a eso la capa de datos:
 *
 * - corre en la tablet con el driver real (`driver-expo.ts`), y
 * - corre en Node bajo Jest con `better-sqlite3` (`driver-node.ts`),
 *   que es como se prueban las migraciones y los repositorios sin un
 *   dispositivo ni un emulador.
 *
 * Se eligio la API sincrona (no la de promesas) porque SQLite local es rapido,
 * porque hace triviales las transacciones de migracion y porque asi la
 * interfaz es la misma que expone `better-sqlite3`. Ver ADR-0004 en el vault.
 */

/** Valor que se puede enlazar a un parametro de una sentencia SQL. */
export type ValorSQL = string | number | null;

/** Parametros de una sentencia: posicionales (`?`) o nombrados (`$nombre`). */
export type ParametrosSQL = ValorSQL[] | Record<string, ValorSQL>;

/** Resultado de una sentencia de escritura. */
export interface ResultadoEscritura {
  /** `rowid` de la ultima fila insertada. */
  lastInsertRowId: number;
  /** Filas afectadas. */
  changes: number;
}

export interface BaseDatos {
  /** Ejecuta uno o varios statements sin parametros (DDL, PRAGMA, etc.). */
  execSync(sql: string): void;

  /** Ejecuta una sentencia de escritura con parametros. */
  runSync(sql: string, params?: ParametrosSQL): ResultadoEscritura;

  /** Devuelve la primera fila, o `null` si no hubo resultados. */
  getFirstSync<T>(sql: string, params?: ParametrosSQL): T | null;

  /** Devuelve todas las filas. */
  getAllSync<T>(sql: string, params?: ParametrosSQL): T[];
}

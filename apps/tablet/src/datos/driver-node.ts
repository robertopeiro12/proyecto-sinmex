/**
 * Driver de SQLite para **pruebas en Node**.
 *
 * > [!warning] No importar desde codigo de la app.
 * > `better-sqlite3` es un modulo nativo de Node: no existe en React Native y
 * > Metro no lo puede empaquetar. Vive en `devDependencies` y solo lo usan los
 * > `*.spec.ts` de esta carpeta. El driver real de la tablet es
 * > `driver-expo.ts`.
 *
 * Existe porque `expo-sqlite` no corre fuera de React Native (necesita el
 * runtime nativo de Expo), y sin un dispositivo/emulador no habria forma de
 * probar migraciones ni repositorios. Al hablar ambos la misma interfaz
 * {@link BaseDatos}, lo que se prueba aqui es el mismo SQL que corre alla.
 * Ver ADR-0004 en el vault.
 */
import Database from 'better-sqlite3';

import type { BaseDatos, ParametrosSQL, ResultadoEscritura } from './base-datos';

/**
 * Abre una base en memoria (o en un archivo, si se pasa ruta) con los mismos
 * PRAGMA de conexion que usa la tablet.
 */
export function abrirBaseDatosNode(ruta = ':memory:'): BaseDatos {
  const bd = new Database(ruta);
  bd.pragma('foreign_keys = ON');

  return {
    execSync(sql: string): void {
      bd.exec(sql);
    },
    runSync(sql: string, params: ParametrosSQL = []): ResultadoEscritura {
      const info = bd.prepare(sql).run(normalizar(params));
      return {
        lastInsertRowId: Number(info.lastInsertRowid),
        changes: info.changes,
      };
    },
    getFirstSync<T>(sql: string, params: ParametrosSQL = []): T | null {
      return (bd.prepare(sql).get(normalizar(params)) as T | undefined) ?? null;
    },
    getAllSync<T>(sql: string, params: ParametrosSQL = []): T[] {
      return bd.prepare(sql).all(normalizar(params)) as T[];
    },
  };
}

/**
 * expo-sqlite acepta parametros nombrados con prefijo (`$id`, `:id`);
 * better-sqlite3 los quiere **sin** prefijo en el objeto. Se normaliza aqui
 * para que el mismo SQL y los mismos parametros sirvan en ambos drivers.
 */
function normalizar(params: ParametrosSQL): unknown[] | Record<string, unknown> {
  if (Array.isArray(params)) return params;
  return Object.fromEntries(
    Object.entries(params).map(([clave, valor]) => [clave.replace(/^[$:@]/, ''), valor]),
  );
}

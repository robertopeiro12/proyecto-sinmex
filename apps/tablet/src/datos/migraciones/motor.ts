import type { BaseDatos } from '../base-datos';

/**
 * Una migracion del esquema **local** de la tablet.
 *
 * `version` es densa y arranca en 1. La version N deja la base en
 * `PRAGMA user_version = N`.
 */
export interface Migracion {
  version: number;
  nombre: string;
  /** SQL a aplicar. Se ejecuta dentro de una transaccion. */
  sql: string;
}

export interface ResultadoMigraciones {
  versionInicial: number;
  versionFinal: number;
  aplicadas: Migracion[];
}

/** Lee `PRAGMA user_version`. Una base recien creada devuelve 0. */
export function versionEsquema(bd: BaseDatos): number {
  const fila = bd.getFirstSync<{ user_version: number }>('pragma user_version;');
  return fila?.user_version ?? 0;
}

/**
 * Aplica, en orden, las migraciones cuya version sea mayor a la actual.
 *
 * Es idempotente: correrlo dos veces seguidas no aplica nada la segunda vez.
 *
 * **Por que `PRAGMA user_version` y no una tabla propia:** es un entero que
 * SQLite guarda en la cabecera del archivo, existe desde antes de la primera
 * migracion (no hay problema del huevo y la gallina) y no puede desincronizarse
 * del archivo porque viaja dentro de el. El precio es que no guarda historial
 * de cuando se aplico cada migracion; para la tablet eso no importa, porque el
 * historial que interesa es el del repo, no el del dispositivo.
 * Ver ADR-0004 en el vault.
 */
export function ejecutarMigraciones(
  bd: BaseDatos,
  migraciones: readonly Migracion[],
): ResultadoMigraciones {
  validarCatalogo(migraciones);

  const versionInicial = versionEsquema(bd);
  const pendientes = migraciones.filter((m) => m.version > versionInicial);
  const aplicadas: Migracion[] = [];

  for (const migracion of pendientes) {
    // `user_version` no acepta parametros enlazados, pero el valor es un entero
    // validado por `validarCatalogo`, nunca entrada del usuario.
    bd.execSync('begin;');
    try {
      bd.execSync(migracion.sql);
      bd.execSync(`pragma user_version = ${migracion.version};`);
      bd.execSync('commit;');
    } catch (error) {
      bd.execSync('rollback;');
      throw new Error(
        `Fallo la migracion local ${migracion.version} (${migracion.nombre}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    aplicadas.push(migracion);
  }

  return { versionInicial, versionFinal: versionEsquema(bd), aplicadas };
}

/**
 * Un catalogo mal formado (versiones repetidas, desordenadas, con huecos o no
 * enteras) rompe la migracion de forma silenciosa en los dispositivos que ya
 * pasaron por una version intermedia. Se detecta al arrancar, no en produccion.
 */
function validarCatalogo(migraciones: readonly Migracion[]): void {
  migraciones.forEach((migracion, indice) => {
    const esperada = indice + 1;
    if (!Number.isInteger(migracion.version) || migracion.version !== esperada) {
      throw new Error(
        `Catalogo de migraciones invalido: se esperaba la version ${esperada} en la posicion ${indice}, se encontro ${migracion.version} (${migracion.nombre}).`,
      );
    }
  });
}

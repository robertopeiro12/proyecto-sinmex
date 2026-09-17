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
  /**
   * Apaga `PRAGMA foreign_keys` mientras corre esta migracion.
   *
   * > [!danger] Solo para **rehacer una tabla**, y no se pone "por si acaso"
   * > Es el unico caso que lo necesita, y SQLite no ofrece otra salida. Para
   * > cambiar una columna (por ejemplo quitarle un `not null`, que `ALTER TABLE`
   * > no sabe hacer) hay que crear la tabla nueva, copiar, **borrar la vieja** y
   * > renombrar. Con las llaves foraneas encendidas eso es imposible:
   * >
   * > - `drop table cliente` hace un `DELETE FROM` implicito, y las filas de
   * >   `cliente_precio` / `nota_pendiente` que la referencian lo convierten en
   * >   `FOREIGN KEY constraint failed`.
   * > - `PRAGMA defer_foreign_keys = on` **no lo arregla** (comprobado en
   * >   SQLite 3.53.2: falla igual).
   * > - `alter table cliente rename to cliente_vieja` es peor: con
   * >   `legacy_alter_table` apagado (el default desde SQLite 3.26) SQLite
   * >   **siempre reescribe las clausulas `references`** de las hijas para que
   * >   apunten a `cliente_vieja` — con las llaves foraneas encendidas o
   * >   apagadas da igual — y `pragma foreign_key_check` no lo detecta mientras
   * >   `cliente_vieja` siga existiendo: el esquema queda corrupto en silencio.
   * >
   * > Es el procedimiento que la propia documentacion de SQLite manda para esto,
   * > y exige apagar el pragma **fuera** de la transaccion: dentro es un no-op
   * > silencioso. De ahi que sea el motor quien lo haga y no la migracion.
   *
   * Antes del `commit` se corre `pragma foreign_key_check`: si la migracion dejo
   * una referencia huerfana, se revierte en vez de confiarse.
   *
   * - `true` comprueba **toda la base**. Es el default seguro, pero un huerfano
   *   preexistente en una tabla que la migracion ni toco (por ejemplo una
   *   `jornada` que apunta a un `vehiculo` que ya no existe) tambien la hace
   *   fallar, y como el chequeo corre en cada arranque, la app no vuelve a abrir
   *   nunca.
   * - `{ comprobar: [...] }` acota el chequeo a esas tablas **hijas** de la
   *   tabla rehecha (una llamada a `pragma foreign_key_check(<tabla>)` por
   *   tabla listada): solo revisa lo que esta migracion pudo haber roto. Es la
   *   forma preferida cuando se conocen las hijas.
   */
  sinLlavesForaneas?: true | { comprobar: string[] };
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
    // Fuera de la transaccion a proposito: dentro, este pragma es un no-op que
    // no avisa. Ver `Migracion.sinLlavesForaneas`.
    if (migracion.sinLlavesForaneas) bd.execSync('pragma foreign_keys = OFF;');
    // `user_version` no acepta parametros enlazados, pero el valor es un entero
    // validado por `validarCatalogo`, nunca entrada del usuario.
    bd.execSync('begin;');
    try {
      bd.execSync(migracion.sql);
      if (migracion.sinLlavesForaneas) exigirIntegridadReferencial(bd, migracion);
      bd.execSync(`pragma user_version = ${migracion.version};`);
      bd.execSync('commit;');
    } catch (error) {
      bd.execSync('rollback;');
      throw new Error(
        `Fallo la migracion local ${migracion.version} (${migracion.nombre}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      // En el `finally` y no despues del `commit`: si la migracion falla, la
      // conexion tiene que volver a quedar con las llaves encendidas igual.
      if (migracion.sinLlavesForaneas) bd.execSync('pragma foreign_keys = ON;');
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

/**
 * Comprueba que una migracion con las llaves foraneas apagadas no dejo
 * referencias huerfanas.
 *
 * `pragma foreign_key_check` **devuelve filas, no lanza**: sin esto, una tabla
 * rehecha a la que se le olvidara copiar la mitad de los datos pasaria el
 * `commit` sin una sola queja, y el fallo aparecerian dias despues en campo.
 *
 * Con `sinLlavesForaneas: true` se comprueba toda la base (`pragma
 * foreign_key_check;`, sin argumento). Con `{ comprobar: [...] }` se llama al
 * pragma una vez por tabla listada (`pragma foreign_key_check(<tabla>)`),
 * acotando el chequeo a las hijas de la tabla que esta migracion rehizo: un
 * huerfano preexistente en una tabla ajena no bloquea el arranque. Los
 * nombres de tabla vienen del catalogo de migraciones (nunca de entrada del
 * usuario), asi que interpolarlos en el pragma es seguro.
 */
function exigirIntegridadReferencial(bd: BaseDatos, migracion: Migracion): void {
  const bandera = migracion.sinLlavesForaneas;
  if (!bandera) return; // el llamador ya comprobo la bandera; esto es solo para el tipo
  const huerfanas =
    bandera === true
      ? bd.getAllSync<{ table: string; rowid: number | null }>('pragma foreign_key_check;')
      : bandera.comprobar.flatMap((tabla) =>
          bd.getAllSync<{ table: string; rowid: number | null }>(
            `pragma foreign_key_check(${tabla});`,
          ),
        );
  if (huerfanas.length > 0) {
    const tablas = [...new Set(huerfanas.map((f) => f.table))].join(', ');
    throw new Error(
      `dejo ${huerfanas.length} referencia(s) huerfana(s) en: ${tablas}. ` +
        `La migracion ${migracion.version} corrio con las llaves foraneas apagadas y no se puede confirmar.`,
    );
  }
}

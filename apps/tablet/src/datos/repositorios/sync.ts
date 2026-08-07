import type { DepsRepositorio } from './deps';
import type { MomentoISO } from '../tipos';

/**
 * Estado de la sincronizacion que la tablet tiene que recordar entre arranques.
 *
 * Hoy es solo el **cursor del pull incremental**: la marca que devolvio el
 * servidor en la ultima bajada y que la tablet manda como `desde` en la
 * siguiente, para no volver a descargar el catalogo entero cada vez.
 *
 * Vive en SQLite y no en memoria porque el caso normal es que la app se cierre
 * entre sincronizaciones (el vendedor apaga la tablet al terminar el dia). Y no
 * vive en el almacenamiento cifrado porque no es un secreto: es una marca de
 * tiempo, y perderla solo cuesta una descarga completa de mas.
 */

/** Unico cursor por ahora. T-44 podra anadir otros sin migrar de nuevo. */
export const CURSOR_PULL = 'pull';

export type RepositorioSync = ReturnType<typeof crearRepositorioSync>;

export function crearRepositorioSync({ bd, reloj }: DepsRepositorio) {
  return {
    /** El cursor guardado, o `null` si esta tablet nunca ha sincronizado. */
    leerCursor(entidad: string = CURSOR_PULL): MomentoISO | null {
      const fila = bd.getFirstSync<{ cursor: string }>(
        'select cursor from sync_cursor where entidad = $entidad',
        { $entidad: entidad },
      );
      return fila?.cursor ?? null;
    },

    /**
     * Guarda el cursor que devolvio el servidor.
     *
     * Se llama **despues** de aplicar el snapshot y dentro de la misma
     * secuencia: si se guardara antes y la escritura del snapshot fallara, la
     * tablet creeria estar al dia sin estarlo, y esos cambios no volverian a
     * bajar nunca.
     */
    guardarCursor(cursor: MomentoISO, entidad: string = CURSOR_PULL): void {
      bd.runSync(
        `insert into sync_cursor (entidad, cursor, actualizado_en)
         values ($entidad, $cursor, $actualizado_en)
         on conflict(entidad) do update set
           cursor = excluded.cursor,
           actualizado_en = excluded.actualizado_en`,
        { $entidad: entidad, $cursor: cursor, $actualizado_en: reloj.ahora() },
      );
    },

    /**
     * Olvida el cursor: la proxima sincronizacion sera un vuelco completo.
     *
     * Es la salida de emergencia cuando la tablet queda descuadrada (T-43
     * tendra formas mas finas). Volver a bajarlo todo es caro pero nunca
     * incorrecto, porque el snapshot se aplica con upsert.
     */
    olvidarCursor(entidad: string = CURSOR_PULL): void {
      bd.runSync('delete from sync_cursor where entidad = $entidad', {
        $entidad: entidad,
      });
    },
  };
}

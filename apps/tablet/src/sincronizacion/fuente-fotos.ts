import type { RepositorioProspectos } from '@/datos/repositorios/prospectos';
import type { MomentoISO } from '@/datos/tipos';

/**
 * La cola de fotos del paso 4 del motor (T-40).
 *
 * Es la hermana de {@link FuenteOperaciones}, pero **deliberadamente no la
 * implementa**: una fuente del push habla de operaciones que se aceptan o se
 * rechazan enteras, y aqui no hay nada que se acepte ni se rechace — hay un
 * archivo que sube o no sube, sin tocar el estado de la operacion. Meter la foto
 * en la misma interfaz seria empezar a borrar justo la separacion que el diseno
 * pide.
 *
 * Si mañana hay otra entidad con foto, implementa esto y se suma a la lista.
 */
export interface FuenteFotos {
  /** Para el log y los mensajes. */
  tipo: string;
  /** Las fotos elegibles, en orden de captura. */
  pendientes(): FotoPorSubir[];
  /** Subida. `subidaEn` es el momento que devolvio el SERVIDOR. */
  marcarSubida(clave: string, subidaEn: MomentoISO): void;
  /** Fallo temporal: se anota y sigue en la cola. */
  anotarError(clave: string, motivo: string): void;
  /** Fallo permanente: se deja de reintentar. */
  descartar(clave: string, motivo: string): void;
}

export interface FotoPorSubir {
  /**
   * La clave de idempotencia de la operacion del prospecto — el `id` de la fila.
   *
   * No es un identificador nuevo, y ahi esta toda la idempotencia de la foto: el
   * servidor nombra el archivo `<clave>.jpg`, asi que **reenviar escribe el mismo
   * nombre** y no hay duplicados posibles. Sin contador, sin tabla de control.
   */
  clave: string;
  /** Ruta del archivo local, ya comprimido. */
  uri: string;
}

/**
 * Las fotos de los prospectos capturados en ruta.
 *
 * `pendientesDeSubirFoto()` ya exige `sync_estado = 'sincronizado'`: antes de que
 * el servidor acepte el alta no existe la fila `cliente` a la que la foto
 * pertenece. Ese estado la tablet lo registra desde T-07 y no hace falta ninguna
 * bandera nueva.
 */
export function fuenteFotosProspectos(
  prospectos: RepositorioProspectos,
): FuenteFotos {
  return {
    tipo: 'prospecto',

    pendientes(): FotoPorSubir[] {
      return prospectos.pendientesDeSubirFoto().flatMap((p) =>
        // `foto_uri` no puede ser null aqui (el `where` lo excluye), pero el tipo
        // de la fila si lo admite: el `flatMap` lo estrecha sin un `!` que
        // mañana sea mentira.
        p.foto_uri === null ? [] : [{ clave: p.id, uri: p.foto_uri }],
      );
    },

    marcarSubida: (clave, subidaEn) => prospectos.marcarFotoSubida(clave, subidaEn),
    anotarError: (clave, motivo) => prospectos.anotarErrorFoto(clave, motivo),
    descartar: (clave, motivo) => prospectos.descartarFoto(clave, motivo),
  };
}

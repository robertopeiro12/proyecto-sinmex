import type { RepositorioProspectos } from '@/datos/repositorios/prospectos';
import type { RepositorioGastos } from '@/datos/repositorios/gastos';
import type { RepositorioVisitas } from '@/datos/repositorios/visitas';
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
   * La clave de idempotencia de la operacion del prospecto, de la visita **o del gasto** —
   * el `id` de la fila.
   *
   * No es un identificador nuevo, y ahi esta toda la idempotencia de la foto: el
   * servidor nombra el archivo por ese id (`cliente-<id>.jpg`, `visita-<id>.jpg`,
   * `gasto-<id>.jpg` en T-30/T-31,
   * T-78), asi que **reenviar escribe el mismo nombre** y no hay duplicados posibles. Sin contador, sin tabla de control.
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

/**
 * Las fotos de las visitas sin venta (T-39, D9). `pendientesDeSubirFoto()` ya
 * exige `sync_estado = 'sincronizado'`: antes de que el servidor acepte la
 * visita no existe la fila a la que la foto pertenece (el canal responde 404/409).
 */
export function fuenteFotosVisitas(visitas: RepositorioVisitas): FuenteFotos {
  return {
    tipo: 'visita',
    pendientes(): FotoPorSubir[] {
      return visitas
        .pendientesDeSubirFoto()
        .flatMap((v) => (v.foto_local === null ? [] : [{ clave: v.id, uri: v.foto_local }]));
    },
    marcarSubida: (clave, subidaEn) => visitas.marcarFotoSubida(clave, subidaEn),
    anotarError: (clave, motivo) => visitas.anotarErrorFoto(clave, motivo),
    descartar: (clave, motivo) => visitas.descartarFoto(clave, motivo),
  };
}

/**
 * Las fotos de los tickets de gasto (T-30/T-31, D8). Opcionales: un gasto sin
 * foto nunca aparece. `pendientesDeSubirFoto()` ya exige
 * `sync_estado = 'sincronizado'`: antes de que el servidor acepte el gasto no
 * existe la fila a la que la foto pertenece (el canal responde 404/409).
 */
export function fuenteFotosGastos(gastos: RepositorioGastos): FuenteFotos {
  return {
    tipo: 'gasto',
    pendientes(): FotoPorSubir[] {
      return gastos
        .pendientesDeSubirFoto()
        .flatMap((g) => (g.foto_local === null ? [] : [{ clave: g.id, uri: g.foto_local }]));
    },
    marcarSubida: (clave, subidaEn) => gastos.marcarFotoSubida(clave, subidaEn),
    anotarError: (clave, motivo) => gastos.anotarErrorFoto(clave, motivo),
    descartar: (clave, motivo) => gastos.descartarFoto(clave, motivo),
  };
}

/**
 * Varias fuentes de fotos vistas como una sola (T-39): el motor sigue hablando
 * con UNA `FuenteFotos` y no cambia. `pendientes()` las concatena en el orden
 * recibido y recuerda de quien es cada clave, para que `marcarSubida`,
 * `anotarError` y `descartar` vuelvan a SU repositorio. Una clave que no salio
 * del ultimo `pendientes()` es un bug del llamador y truena en vez de anotarse
 * en el sitio equivocado.
 */
export function combinarFuentesFotos(fuentes: readonly FuenteFotos[]): FuenteFotos {
  const duenas = new Map<string, FuenteFotos>();
  const duenaDe = (clave: string): FuenteFotos => {
    const fuente = duenas.get(clave);
    if (!fuente) {
      throw new Error(`La foto ${clave} no salio de pendientes(): no se sabe de que fuente es.`);
    }
    return fuente;
  };
  return {
    tipo: fuentes.map((f) => f.tipo).join('+'),
    pendientes(): FotoPorSubir[] {
      duenas.clear();
      return fuentes.flatMap((fuente) =>
        fuente.pendientes().map((foto) => {
          duenas.set(foto.clave, fuente);
          return foto;
        }),
      );
    },
    marcarSubida: (clave, subidaEn) => duenaDe(clave).marcarSubida(clave, subidaEn),
    anotarError: (clave, motivo) => duenaDe(clave).anotarError(clave, motivo),
    descartar: (clave, motivo) => duenaDe(clave).descartar(clave, motivo),
  };
}

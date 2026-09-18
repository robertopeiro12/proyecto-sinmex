import type { FechaISO, MomentoISO, Prospecto } from '../tipos';
import type { RepositorioCatalogos } from './catalogos';
import type { DepsRepositorio } from './deps';

/**
 * Error de regla de negocio del alta de prospecto (no un fallo tecnico de
 * SQLite). Mismo patron que `ErrorJornada` (T-04) y `ErrorVenta` (T-16).
 */
export class ErrorProspecto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorProspecto';
  }
}

/** Lo que captura la pantalla. Los siete campos que dicto el cliente, menos la foto. */
export interface DatosRegistroProspecto {
  vendedorId: string;
  sucursalId: string;
  /** Nombre del negocio. */
  nombre: string;
  telefono: string;
  encargado: string | null;
  tipoNegocioId: string | null;
  comentarios: string | null;
  /**
   * Ubicacion del dispositivo. **Las dos o ninguna.**
   *
   * `null` es un caso normal: si el vendedor niega el permiso de ubicacion o no
   * hay senal, el prospecto se guarda igual. Bloquear el alta por eso seria peor
   * que no tener la coordenada — el vendedor esta parado enfrente del negocio y
   * la alternativa es que no lo registre.
   */
  lat: number | null;
  lng: number | null;
  /**
   * Ruta local de la foto del lugar, **ya comprimida** por `src/fotos/`.
   *
   * Opcional de verdad: si el vendedor no la tomo, o si la camara o la
   * compresion fallaron, llega `null` (o ni se pasa) y el alta sigue su curso.
   * **Un prospecto sin foto es un prospecto completo** — el cliente pidio la
   * foto *"si esto no se hace lento"*, y perder el alta por no poder tomarla
   * seria exactamente lo contrario.
   */
  fotoUri?: string | null;
}

export const LARGO_MAX_NOMBRE = 200;
export const LARGO_MAX_TELEFONO = 30;
export const LARGO_MAX_ENCARGADO = 120;
export const LARGO_MAX_COMENTARIOS = 500;

export type RepositorioProspectos = ReturnType<typeof crearRepositorioProspectos>;

/**
 * Prospectos capturados en ruta (T-40): grabar, listar el dia y la cola del push.
 *
 * Recibe `catalogos` ya creado en vez de crearlo: tiene que ser la **misma
 * instancia** que publica la version que observan las pantallas, y es quien sabe
 * si el tipo de negocio elegido sigue en el catalogo local.
 *
 * > [!info] No emite folio, y no es un olvido
 * > Un prospecto **no es una nota que el cliente firme**, asi que no consume un
 * > numero del contador del dia (ADR-0001). Por eso este repositorio no recibe
 * > `folios` y no abre transaccion: es un solo `insert`, y `enTransaccion` sin
 * > nada que coordinar seria ruido.
 */
export function crearRepositorioProspectos(
  { bd, reloj, generarId }: DepsRepositorio,
  { catalogos }: { catalogos: RepositorioCatalogos },
) {
  const repo = {
    /**
     * Graba un prospecto, listo para subir.
     *
     * Todo lo que puede fallar por una regla se comprueba **antes** de escribir,
     * y con los mismos limites que el servidor (`datos-prospecto.ts`): asi el
     * vendedor se entera en el momento, con el negocio delante, y no un dia
     * despues al sincronizar.
     *
     * @throws {ErrorProspecto} si la captura no se puede grabar.
     */
    registrar(datos: DatosRegistroProspecto): Prospecto {
      const nombre = recortar(datos.nombre);
      if (nombre === null) {
        throw new ErrorProspecto('Captura el nombre del negocio.');
      }
      if (nombre.length > LARGO_MAX_NOMBRE) {
        throw new ErrorProspecto(
          `El nombre del negocio no puede pasar de ${LARGO_MAX_NOMBRE} caracteres.`,
        );
      }

      const telefono = recortar(datos.telefono);
      if (telefono === null) {
        throw new ErrorProspecto('Captura el teléfono del negocio.');
      }
      if (telefono.length > LARGO_MAX_TELEFONO) {
        throw new ErrorProspecto(
          `El teléfono no puede pasar de ${LARGO_MAX_TELEFONO} caracteres.`,
        );
      }

      const encargado = recortar(datos.encargado);
      if (encargado !== null && encargado.length > LARGO_MAX_ENCARGADO) {
        throw new ErrorProspecto(
          `El nombre del encargado no puede pasar de ${LARGO_MAX_ENCARGADO} caracteres.`,
        );
      }

      const comentarios = recortar(datos.comentarios);
      if (comentarios !== null && comentarios.length > LARGO_MAX_COMENTARIOS) {
        throw new ErrorProspecto(
          `El comentario no puede pasar de ${LARGO_MAX_COMENTARIOS} caracteres.`,
        );
      }

      // El tipo de negocio se comprueba contra el catalogo local: si el portal
      // lo dio de baja, el servidor lo rechazaria con `tipo-negocio-inexistente`
      // y el vendedor se enteraria mañana. Aqui se entera ahora.
      if (datos.tipoNegocioId !== null) {
        const tipo = catalogos.obtenerTipoNegocio(datos.tipoNegocioId);
        if (!tipo || tipo.activo !== 1) {
          throw new ErrorProspecto(
            'Ese tipo de negocio ya no está en el catálogo. Sincroniza y vuelve a elegirlo.',
          );
        }
      }

      // Las dos o ninguna, igual que el `check` de la tabla y que el servidor:
      // media coordenada no ubica nada y en el portal se veria como un punto en
      // el meridiano cero, que parece un dato bueno.
      if ((datos.lat === null) !== (datos.lng === null)) {
        throw new ErrorProspecto(
          'La ubicación va completa o no va: falta una de las dos coordenadas.',
        );
      }

      const id = generarId();
      const ahora = reloj.ahora();

      bd.runSync(
        `insert into prospecto (
           id, fecha, vendedor_id, sucursal_id, nombre, telefono, encargado,
           tipo_negocio_id, comentarios, lat, lng, foto_uri, grabado_en, sync_estado
         ) values (
           $id, $fecha, $vendedor_id, $sucursal_id, $nombre, $telefono, $encargado,
           $tipo_negocio_id, $comentarios, $lat, $lng, $foto_uri, $grabado_en, 'pendiente'
         )`,
        {
          $id: id,
          // `reloj.hoy()` es la fecha LOCAL de la tablet (Tijuana), la misma que
          // viaja como `fecha_operacion`: el servidor no la re-deriva de UTC.
          $fecha: reloj.hoy(),
          $vendedor_id: datos.vendedorId,
          $sucursal_id: datos.sucursalId,
          $nombre: nombre,
          $telefono: telefono,
          $encargado: encargado,
          $tipo_negocio_id: datos.tipoNegocioId,
          $comentarios: comentarios,
          $lat: datos.lat,
          $lng: datos.lng,
          // La foto, si la hubo. No se valida nada de ella aqui a proposito:
          // todo lo que podia fallar (permiso, camara, compresion, tamano) ya
          // fallo antes de llegar, y en ese caso esto vale `null`. Este `insert`
          // **no puede** tener una forma de fracasar por la foto.
          $foto_uri: datos.fotoUri ?? null,
          $grabado_en: ahora,
        },
      );

      const grabado = repo.porId(id);
      if (!grabado) {
        throw new ErrorProspecto('No se pudo leer el prospecto recién grabado.');
      }
      return grabado;
    },

    porId(id: string): Prospecto | null {
      return bd.getFirstSync<Prospecto>('select * from prospecto where id = $id', {
        $id: id,
      });
    },

    /**
     * Los prospectos que este vendedor capturo en un dia, en orden de captura.
     *
     * Alimenta la lista "Prospectos de hoy" de la pantalla, con su pastilla de
     * estado de sincronizacion. Por vendedor y no global: la tablet puede
     * compartirse, y lo que el vendedor tiene que revisar es lo suyo.
     */
    delDia(vendedorId: string, fecha: FechaISO = reloj.hoy()): Prospecto[] {
      return bd.getAllSync<Prospecto>(
        `select * from prospecto
          where vendedor_id = $vendedor_id and fecha = $fecha
          order by grabado_en, rowid`,
        { $vendedor_id: vendedorId, $fecha: fecha },
      );
    },

    /**
     * Prospectos que faltan por subir.
     *
     * Incluye los que quedaron en `error`, igual que la jornada y la venta: un
     * `tipo-negocio-inexistente` se recupera en cuanto el administrador arregla
     * el catalogo, y reenviar es seguro porque la clave es el `id` de la fila,
     * que no cambia nunca.
     */
    pendientesDeSincronizar(): Prospecto[] {
      return bd.getAllSync<Prospecto>(
        `select * from prospecto
          where sync_estado in ('pendiente', 'error')
          order by fecha, grabado_en, rowid`,
      );
    },

    /** Subido: se limpia el error de un intento previo. */
    marcarSincronizado(id: string): void {
      bd.runSync(
        `update prospecto set
           sync_estado = 'sincronizado',
           sincronizado_en = $sincronizado_en,
           sync_error = null
         where id = $id`,
        { $sincronizado_en: reloj.ahora(), $id: id },
      );
    },

    /** El servidor lo rechazo: se guarda el motivo para mostrarlo en la lista. */
    marcarError(id: string, motivo: string): void {
      bd.runSync(
        `update prospecto set sync_estado = 'error', sync_error = $motivo where id = $id`,
        { $motivo: motivo, $id: id },
      );
    },

    // ----------------------------------------------------------------------
    // La foto (T-40). Canal aparte del push, y por eso columnas aparte.
    //
    // > [!danger] Ninguno de los tres `update` de abajo menciona `sync_estado`
    // > ni `sync_error`, y eso NO es casual
    // > Es el requisito que da sentido a todo el diseno de la foto: **una foto
    // > que falla no puede tocar el estado del prospecto**. Si un fallo de
    // > subida devolviera el prospecto a `error`, la siguiente pasada lo
    // > reenviaria al push, el servidor contestaria `duplicada` y la fila se
    // > quedaria oscilando; peor aun, la pantalla diria "rechazado" de un
    // > prospecto que el servidor acepto perfectamente. El sintoma en produccion
    // > seria un cliente potencial que nadie visita porque parece no haber
    // > entrado. Hay prueba de esto en `prospectos.spec.ts` y en `motor.spec.ts`.
    //
    // Y al reves tambien: `marcarSincronizado` y `marcarError` no tocan ninguna
    // columna de foto. Las dos mitades son independientes en los dos sentidos.
    // ----------------------------------------------------------------------

    /**
     * Las fotos que toca subir: de prospectos **ya sincronizados**, con archivo,
     * sin subir y no descartadas.
     *
     * > [!important] `sync_estado = 'sincronizado'` no es un filtro de eficiencia
     * > Antes de que el servidor acepte el alta **no existe la fila `cliente` a
     * > la que la foto pertenece**, asi que la subida solo puede responder 404 o
     * > 409. Ese estado la tablet ya lo registra desde T-07: no hace falta
     * > ninguna bandera nueva para saber cuando la foto es elegible.
     *
     * No filtra por vendedor. La tablet puede compartirse, y si el equipo cambia
     * de manos la foto de un prospecto ajeno no va a subir (el servidor responde
     * 403 porque la operacion no es de quien manda el token): eso se anota como
     * error **temporal** y se reintenta, para que suba el dia que su vendedor
     * vuelva a entrar. Descartarla seria perder una foto que si tenia destino.
     */
    pendientesDeSubirFoto(): Prospecto[] {
      return bd.getAllSync<Prospecto>(
        `select * from prospecto
          where sync_estado = 'sincronizado'
            and foto_uri is not null
            and foto_subida_en is null
            and foto_descartada = 0
          order by fecha, grabado_en, rowid`,
      );
    },

    /**
     * La foto esta arriba. `subidaEn` es lo que respondio el SERVIDOR.
     *
     * Se limpia `foto_error`: un motivo viejo junto a una foto ya subida se lee
     * en pantalla como un fallo que no existe.
     */
    marcarFotoSubida(id: string, subidaEn: MomentoISO): void {
      bd.runSync(
        `update prospecto set foto_subida_en = $subida_en, foto_error = null where id = $id`,
        { $subida_en: subidaEn, $id: id },
      );
    },

    /**
     * Fallo **temporal**: se anota el motivo y la foto sigue en la cola.
     *
     * Es el caso de la WiFi que se cayo a medias, del prospecto que el servidor
     * todavia no proyecto (409) y del 403 de un equipo que cambio de manos.
     * Todos se arreglan solos con el tiempo.
     */
    anotarErrorFoto(id: string, motivo: string): void {
      bd.runSync(`update prospecto set foto_error = $motivo where id = $id`, {
        $motivo: motivo,
        $id: id,
      });
    },

    /**
     * Fallo **permanente**: se deja de reintentar.
     *
     * Solo tres motivos, y los tres son juicios sobre *estos bytes* que no
     * cambian por mandarlos otra vez: 413 (pasa de 2 MB), 415 (no es un JPEG de
     * verdad) y el archivo local que desaparecio. Tratar uno de ellos como
     * temporal es reintentar en cada sincronizacion, para siempre, una foto que
     * nunca va a entrar.
     *
     * Se conserva `foto_uri` en vez de borrarla: es la unica pista de que hubo
     * una foto que no llego, y el motivo queda en `foto_error` para la pantalla.
     */
    descartarFoto(id: string, motivo: string): void {
      bd.runSync(
        `update prospecto set foto_descartada = 1, foto_error = $motivo where id = $id`,
        { $motivo: motivo, $id: id },
      );
    },
  };

  return repo;
}

/** Texto recortado no vacio, o `null`. */
function recortar(valor: string | null): string | null {
  if (valor === null) return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}

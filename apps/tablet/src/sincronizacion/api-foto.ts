/**
 * Cliente de `POST /sync/foto/:clave` — el segundo de los "dos requests, un
 * boton" (T-40).
 *
 * > [!warning] Archivo aparte de `api.ts`, y no por orden
 * > **El mismo codigo HTTP significa cosas opuestas en los dos canales.** En el
 * > push, un `409` es "el contrato no coincide, actualiza la app"; aqui es "ese
 * > prospecto todavia no esta proyectado, vuelve a intentarlo". Reusar el `pedir`
 * > de `api.ts` haria que un 409 del canal de la foto se leyera como contrato
 * > incompatible y abortara la sincronizacion entera — por una foto opcional.
 *
 * ## Las clases dicen QUE HACER, no que paso
 *
 * La decision que la tablet tiene que tomar con cada fallo es una sola:
 * ¿reintento esta foto o la doy por perdida? Asi que los errores se nombran por
 * esa decision y no por el codigo HTTP, que es solo la pista para tomarla.
 *
 * | Respuesta | Clase | Que hace la tablet |
 * |---|---|---|
 * | 413 (pasa de 2 MB) | {@link FotoPermanenteError} | descarta, no reintenta |
 * | 415 (no es JPEG de verdad) | {@link FotoPermanenteError} | descarta, no reintenta |
 * | 404 (el servidor no conoce la clave) | {@link FotoTemporalError} | anota y reintenta |
 * | 409 (aun sin proyectar) | {@link FotoTemporalError} | anota y reintenta |
 * | 403 (la operacion no es de este vendedor) | {@link FotoTemporalError} | anota y reintenta |
 * | 400, 5xx | {@link FotoTemporalError} | anota y reintenta |
 * | 401 | `SesionRechazadaError` | corta el paso: hay que renovar |
 * | no hubo respuesta | `SinRedError` | corta el paso: no hay WiFi |
 *
 * > [!danger] Confundir permanente con temporal rompe en las dos direcciones
 * > Un **413 leido como temporal** es la tablet reintentando la misma foto
 * > gigante en cada sincronizacion, para siempre, gastando la WiFi del negocio
 * > sin que nadie se entere. Es el mismo fallo que `MAX_BYTES_POR_LOTE` corto en
 * > el push.
 * >
 * > Y un **403 leido como permanente** seria peor: si el equipo cambio de manos,
 * > el servidor rechaza la foto porque quien manda el token no es quien capturo
 * > el prospecto — pero esa foto **subiria perfectamente** el dia que su vendedor
 * > vuelva a entrar. Descartarla es perder en silencio la foto de un cliente
 * > potencial, que es exactamente lo que todo este diseno existe para evitar.
 * >
 * > La regla para clasificar una respuesta nueva: permanente **solo** si es un
 * > juicio sobre *estos bytes*. Todo lo demas es temporal.
 */
import { SesionRechazadaError } from './api';

/**
 * No se arregla reintentando: el servidor ya juzgo **estos bytes** (413, 415) o
 * el archivo local ya no esta. Se descarta la foto y se deja de intentar.
 */
export class FotoPermanenteError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'FotoPermanenteError';
  }
}

/**
 * Esta vez no subio, pero puede subir despues: el prospecto aun no esta
 * proyectado, el equipo cambio de manos, el backend se cayo. Se anota el motivo
 * y la foto **sigue en la cola**.
 */
export class FotoTemporalError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'FotoTemporalError';
  }
}

/** Lo que el transporte devuelve de una subida que SI obtuvo respuesta. */
export interface RespuestaCruda {
  status: number;
  /** Cuerpo tal cual, sin parsear. Puede no ser JSON (un 502 de un proxy). */
  body: string;
}

/**
 * El envio de los bytes, que es lo unico nativo.
 *
 * En la tablet lo implementa `expo-file-system` (ver `@/fotos/expo`), que sube el
 * archivo directo desde disco sin cargarlo en memoria. En las pruebas es una
 * funcion que devuelve `status`.
 *
 * Contrato: devuelve la respuesta **para cualquier codigo HTTP**, y lanza
 * `SinRedError` solo si no hubo respuesta (o `FotoPermanenteError` si el archivo
 * local ya no esta). Que la clasificacion dependa del `status` y no de si la
 * promesa fallo es justo lo que permite distinguir un 413 de una WiFi caida.
 */
export type EnviarFoto = (
  url: string,
  tokenAcceso: string,
  uri: string,
) => Promise<RespuestaCruda>;

/** Lo que responde el servidor cuando acepta. */
interface CuerpoRespuestaFoto {
  clave: string;
  /** Cuando la recibio el servidor, en ISO. */
  subida_en: string;
}

export interface ClienteFotos {
  /**
   * Sube una foto y devuelve **el momento del servidor** en que la recibio.
   *
   * @throws {FotoPermanenteError} si esa foto no va a entrar nunca.
   * @throws {FotoTemporalError} si puede entrar en otra pasada.
   * @throws {SesionRechazadaError} si hay que renovar la sesion.
   * @throws `SinRedError` si no hubo respuesta — lo lanza el transporte
   *   (`enviar`) y este cliente lo deja pasar tal cual, sin reinterpretarlo.
   */
  subir(tokenAcceso: string, clave: string, uri: string): Promise<string>;
}

export function crearClienteFotos(enviar: EnviarFoto, base: string): ClienteFotos {
  return {
    async subir(tokenAcceso, clave, uri) {
      // La clave va tal cual, en minusculas: el servidor la usa como NOMBRE DE
      // ARCHIVO y compara `clave_idempotencia` (que es `text`) distinguiendo
      // mayusculas. `expo-crypto.randomUUID` ya las genera en minusculas; el
      // `toLowerCase` es para que un id que viniera de otra parte no acabe en un
      // 404 desconcertante.
      const respuesta = await enviar(
        `${base}/sync/foto/${encodeURIComponent(clave.toLowerCase())}`,
        tokenAcceso,
        uri,
      );

      if (respuesta.status === 401) throw new SesionRechazadaError();

      // Permanentes: los dos son juicios sobre ESTOS bytes. Van antes que
      // cualquier cajon de sastre, porque tratarlos como temporales es el bucle
      // infinito del aviso de la cabecera.
      if (respuesta.status === 413) {
        throw new FotoPermanenteError(
          `La foto pesa mas de lo que el servidor acepta y no va a entrar nunca: ${mensajeDe(respuesta)}`,
        );
      }
      if (respuesta.status === 415) {
        throw new FotoPermanenteError(
          `El servidor no reconocio el archivo como un JPEG completo: ${mensajeDe(respuesta)}`,
        );
      }

      if (!estaOk(respuesta.status)) {
        // 404, 409, 403, 400 y 5xx. Todos se pueden arreglar con el tiempo: el
        // push que falta, la proyeccion pendiente, el vendedor que vuelve a
        // entrar, el backend que se levanta.
        throw new FotoTemporalError(mensajeDe(respuesta));
      }

      // El servidor responde 200 tambien en la primera subida (la operacion es
      // idempotente: la ruta la fija la clave). No hay 201 que distinguir.
      const cuerpo = leerCuerpo(respuesta.body);
      if (cuerpo === null) {
        // Acepto pero no se entiende lo que dijo. No se puede marcar como subida
        // sin el momento del servidor, asi que se reintenta — y como la subida es
        // idempotente, reintentarla no deja dos archivos.
        throw new FotoTemporalError(
          'El servidor acepto la foto pero su respuesta no se pudo leer.',
        );
      }
      return cuerpo.subida_en;
    },
  };
}

function estaOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function leerCuerpo(body: string): CuerpoRespuestaFoto | null {
  try {
    const cuerpo = JSON.parse(body) as Partial<CuerpoRespuestaFoto>;
    return typeof cuerpo.subida_en === 'string' && typeof cuerpo.clave === 'string'
      ? { clave: cuerpo.clave, subida_en: cuerpo.subida_en }
      : null;
  } catch {
    return null;
  }
}

/**
 * El `message` de Nest, si el cuerpo era el JSON de error que se espera.
 *
 * Con red mala el cuerpo puede ser el HTML de un portal cautivo, asi que esto no
 * puede lanzar: el motivo acaba en la pantalla del vendedor, y quedarse sin
 * clasificar el error por no poder formatear el texto seria absurdo.
 */
function mensajeDe(respuesta: RespuestaCruda): string {
  try {
    const cuerpo = JSON.parse(respuesta.body) as { message?: string | string[] };
    const mensaje = Array.isArray(cuerpo.message)
      ? cuerpo.message.join(' ')
      : cuerpo.message;
    if (typeof mensaje === 'string' && mensaje !== '') return mensaje;
  } catch {
    // Cuerpo que no es JSON: se cae al texto de abajo.
  }
  return `El servidor respondio ${respuesta.status}.`;
}

/**
 * Los adaptadores nativos de la foto del prospecto (T-40).
 *
 * Aqui vive **todo** lo que toca la camara, el disco y el modulo de imagen, y
 * nada mas. Es el unico archivo de `src/fotos/` que no se puede probar en Node,
 * y por eso no tiene ni una decision dentro: la compresion decide en
 * `comprimir.ts`, la clasificacion de errores en
 * `@/sincronizacion/api-foto.ts`, y lo de aqui solo traduce a la API de Expo.
 * Mismo reparto que `sesion/almacen-secure-store.ts` frente a `sesion/politica.ts`.
 */
import { UploadType, File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { SinRedError, URL_API } from '@/sesion/api';
import {
  FotoPermanenteError,
  crearClienteFotos,
  type ClienteFotos,
  type EnviarFoto,
} from '@/sincronizacion/api-foto';

import {
  comprimirParaSubir,
  ErrorCompresion,
  type FotoComprimida,
  type Manipulador,
} from './comprimir';

/**
 * `expo-image-manipulator` + el tamano real del archivo.
 *
 * Los bytes salen de `new File(uri).size`, **medidos del archivo que se acaba de
 * escribir**, no estimados de la calidad: el bucle de `comprimirParaSubir`
 * depende de ese numero para saber si ya llego a los 300 kB, y una estimacion
 * convertiria el objetivo en una ilusion.
 */
export const manipuladorExpo: Manipulador = {
  async guardar({ uri, ladoMayor, vertical, calidad }) {
    const contexto = ImageManipulator.manipulate(uri);
    // Se fija UN lado y el modulo calcula el otro conservando la proporcion. Cual
    // se fija depende de la orientacion: pedir `width` a una foto vertical le
    // dejaria el alto mas grande que el limite que se queria poner.
    contexto.resize(vertical ? { height: ladoMayor } : { width: ladoMayor });

    const imagen = await contexto.renderAsync();
    const guardada = await imagen.saveAsync({
      format: SaveFormat.JPEG,
      compress: calidad,
      // Sin `base64`: seria un 33% mas de memoria de una foto que solo tiene que
      // llegar al disco.
    });

    return { uri: guardada.uri, bytes: new File(guardada.uri).size };
  },
};

/** Lo que puede salir de pedirle una foto al vendedor. */
export type ResultadoCaptura =
  | { estado: 'ok'; foto: FotoComprimida }
  /** Dijo que no al permiso de camara. */
  | { estado: 'permiso-negado' }
  /** Abrio la camara y se echo para atras. Ni error ni foto. */
  | { estado: 'cancelado' }
  /**
   * Se tomo la foto y no se pudo dejar en un tamano que el servidor acepte, o la
   * camara fallo. `motivo` es para el log, no para el vendedor.
   */
  | { estado: 'fallo'; motivo: string };

/**
 * Pide una foto del lugar y la devuelve **ya comprimida**.
 *
 * > [!danger] Esta funcion no lanza nunca, y eso es el requisito
 * > Quien la llama es el alta del prospecto. Cualquier excepcion que se escapara
 * > de aqui —permiso, camara, disco, compresion— podria acabar impidiendo el
 * > alta, y **perder un cliente potencial por no poder tomar una foto opcional**
 * > es exactamente el fallo que este diseno existe para prevenir. Todo sale como
 * > un `estado`, y el peor de ellos significa "guarda el prospecto sin foto".
 *
 * La camara se abre con `quality: 1`: comprimir dos veces (la camara y luego
 * nosotros) pierde detalle sin ahorrar nada, porque el tamano final lo fija el
 * bucle de `comprimirParaSubir` midiendo.
 */
export async function capturarFotoProspecto(): Promise<ResultadoCaptura> {
  try {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) return { estado: 'permiso-negado' };

    const captura = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      // Sin recorte: es una foto de una fachada, no un avatar, y el paso extra
      // es tiempo del vendedor parado enfrente del negocio.
      allowsEditing: false,
      quality: 1,
      // Sin copia a la galeria del equipo: la foto es dato de la empresa y el
      // equipo es personal (ADR-0010).
      exif: false,
    });

    if (captura.canceled) return { estado: 'cancelado' };

    const asset = captura.assets[0];
    if (!asset) return { estado: 'fallo', motivo: 'La camara no devolvio ninguna foto.' };

    const foto = await comprimirParaSubir(
      {
        uri: asset.uri,
        // Si la camara no reporta medidas se asume horizontal con el lado ya en
        // el objetivo: `comprimirParaSubir` nunca agranda, asi que lo peor que
        // pasa es que no redimensione y la calidad haga el trabajo sola.
        ancho: asset.width ?? 1600,
        alto: asset.height ?? 1200,
      },
      manipuladorExpo,
    );
    return { estado: 'ok', foto };
  } catch (error) {
    return {
      estado: 'fallo',
      motivo:
        error instanceof ErrorCompresion
          ? error.message
          : `No se pudo tomar la foto: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Sube el archivo con `expo-file-system`, en binario y directo desde el disco.
 *
 * Y no con `fetch`: `File.upload` **transmite el archivo sin cargarlo en la
 * memoria de JavaScript**, que es lo que se quiere de una tablet vieja con un
 * JPEG de cientos de kB. Ademas resuelve con el `status` para **cualquier**
 * codigo HTTP y solo rechaza si no hubo respuesta — que es justo la frontera que
 * `api-foto.ts` necesita para distinguir un 413 (permanente) de una WiFi caida
 * (temporal). Con `fetch` habria que reconstruir esa distincion a mano.
 *
 * El cuerpo es el JPEG **crudo**, sin sobre JSON ni multipart: no hay ningun otro
 * campo que mandar (la clave va en la URL) y base64 costaria un 33% mas de bytes
 * en la WiFi del negocio.
 */
export const enviarFotoExpo: EnviarFoto = async (url, tokenAcceso, uri) => {
  const archivo = new File(uri);

  // El archivo vive en la cache del equipo, y el sistema la limpia cuando le
  // hace falta espacio. Si ya no esta, no hay nada que subir **nunca**: es un
  // fallo permanente, no un reintento eterno contra un archivo que no vuelve.
  // Se comprueba aqui y no en el motor porque es lo unico de esta decision que
  // necesita tocar el disco.
  if (!archivo.exists) {
    throw new FotoPermanenteError(
      'El archivo de la foto ya no esta en el equipo (la cache se limpio). El prospecto queda sin foto.',
    );
  }

  try {
    const respuesta = await archivo.upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: 'image/jpeg',
      headers: {
        Authorization: `Bearer ${tokenAcceso}`,
        // El servidor lee el cuerpo a mano justamente porque este tipo no lo toca
        // ningun parser de express (ver `cuerpo-crudo.ts` del backend).
        'Content-Type': 'image/jpeg',
      },
    });

    return { status: respuesta.status, body: respuesta.body };
  } catch (error) {
    // `upload` solo rechaza si no hubo respuesta o si el archivo no se pudo leer.
    // Las dos cosas son **temporales** desde aqui: la WiFi vuelve, y un archivo
    // que existia hace una linea y no se pudo leer merece otro intento antes de
    // darlo por perdido. El mismo criterio que `sesion/api.ts` — cualquier fallo
    // de transporte es "no hay red", y asi el vendedor sigue trabajando.
    throw new SinRedError(error);
  }
};

/** El cliente de fotos ya cableado con el transporte real. */
export function crearClienteFotosExpo(base: string = URL_API): ClienteFotos {
  return crearClienteFotos(enviarFotoExpo, base);
}

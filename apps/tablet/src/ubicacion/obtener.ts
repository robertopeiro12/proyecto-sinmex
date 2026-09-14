import * as Location from 'expo-location';

/**
 * La ubicacion del dispositivo, para el alta de prospectos (T-40).
 *
 * Vive aparte de la pantalla por dos razones:
 *
 * 1. **Nunca lanza.** Devuelve un resultado que dice que paso, porque lo que no
 *    puede ocurrir es que un permiso negado o un GPS sin senal impidan registrar
 *    al prospecto. El vendedor esta parado enfrente del negocio; si la app lo
 *    bloquea, la alternativa real no es "vuelve con permiso", es que no lo
 *    registre.
 * 2. **Se puede probar sin dispositivo**, y la pantalla no tiene que saber nada
 *    de `expo-location`.
 *
 * > [!info] Solo en primer plano
 * > `requestForegroundPermissionsAsync`, nunca el permiso de segundo plano. El
 * > rastreo continuo (el "detecta vueltas personales" del criterio de T-41) es
 * > otro ticket y necesita su propio ADR de mapas; pedir el permiso fuerte aqui
 * > lo adelantaria sin que nadie lo haya decidido.
 */

export type ResultadoUbicacion =
  | { estado: 'ok'; lat: number; lng: number }
  /** El vendedor dijo no. Se guarda sin coordenadas y se le avisa. */
  | { estado: 'permiso-negado' }
  /**
   * Hay permiso pero no se pudo leer la posicion: GPS apagado, dentro de una
   * bodega, o el aparato tardo demasiado. Se distingue del permiso negado porque
   * el mensaje al vendedor es distinto — aqui reintentar si puede servir.
   */
  | { estado: 'sin-senal'; detalle: string };

/**
 * Cuanto se espera una lectura antes de rendirse.
 *
 * `getCurrentPositionAsync` puede no volver nunca dentro de un local cerrado, y
 * un boton que se queda girando para siempre es peor que uno que dice "no pude":
 * el vendedor se queda mirando la pantalla sin saber si esperar.
 */
export const TIEMPO_MAX_MS = 10_000;

export async function obtenerUbicacion(): Promise<ResultadoUbicacion> {
  try {
    const permiso = await Location.requestForegroundPermissionsAsync();
    if (!permiso.granted) return { estado: 'permiso-negado' };

    const posicion = await conTiempoMaximo(
      Location.getCurrentPositionAsync({
        // `Balanced` y no `Highest`: la precision de ~100 m sobra para ubicar un
        // negocio en un mapa y evita que el aparato se quede esperando una
        // fijacion de satelites que dentro de un local no va a llegar.
        accuracy: Location.Accuracy.Balanced,
      }),
      TIEMPO_MAX_MS,
    );

    return {
      estado: 'ok',
      lat: posicion.coords.latitude,
      lng: posicion.coords.longitude,
    };
  } catch (error) {
    return {
      estado: 'sin-senal',
      detalle: error instanceof Error ? error.message : String(error),
    };
  }
}

/** `promesa`, o un error si tarda mas de `ms`. */
function conTiempoMaximo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(
      () => rechazar(new Error(`No hubo lectura de ubicacion en ${ms / 1000} s.`)),
      ms,
    );
    promesa.then(
      (valor) => {
        clearTimeout(reloj);
        resolver(valor);
      },
      (error) => {
        clearTimeout(reloj);
        rechazar(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

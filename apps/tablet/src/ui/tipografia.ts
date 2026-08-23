import {
  Barlow_400Regular,
  Barlow_500Medium,
  Barlow_600SemiBold,
} from '@expo-google-fonts/barlow';
import {
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
} from '@expo-google-fonts/barlow-condensed';
import {
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';
import { useFonts } from 'expo-font';

/**
 * Carga de las tipografias del sistema de diseno.
 *
 * > [!important] La app NO espera a las fuentes para pintar
 * > `useTipografias()` devuelve un booleano y nadie lo usa para bloquear. Si
 * > las fuentes no estan listas, `tema.ts` deja `fontFamily: undefined` y
 * > Android pinta con la tipografia del sistema: la app **se ve peor durante
 * > unos milisegundos, pero se ve**.
 * >
 * > Es deliberado y sigue la misma linea que `src/sesion/almacen.ts`: el
 * > arranque no se retrasa por nada que no sea imprescindible. Un vendedor
 * > abriendo la app en la banqueta, con la camioneta en doble fila, no puede
 * > quedarse mirando una pantalla en blanco porque un `.ttf` tardo.
 *
 * Son 7 cortes y no mas. Cada peso son ~100 KB en el APK y ninguno esta
 * "por si acaso": los tres de Barlow cubren texto, los dos condensados cubren
 * titulos, y los dos monoespaciados son los unicos que garantizan que las
 * cifras alineen en columna (ver el componente `Cifra`).
 */
export function useTipografias(): boolean {
  const [listas] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  return listas;
}

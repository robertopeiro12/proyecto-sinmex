// Se importa **el corte concreto**, no el paquete.
//
// `@expo-google-fonts/barlow` es un `index.js` con un `require()` de cada peso
// en el nivel superior: tocarlo mete los 18 cortes de la familia en el grafo, y
// Metro no puede podar un `require` incondicional. Medido con `expo export`:
// importando desde la raiz el bundle se llevaba **51 .ttf (~5,4 MB)** para usar
// 7. Importando el subcamino, solo bajan los 7.
//
// No es una micro-optimizacion: el APK se instala por WiFi en tablets de campo.
import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular';
import { Barlow_500Medium } from '@expo-google-fonts/barlow/500Medium';
import { Barlow_600SemiBold } from '@expo-google-fonts/barlow/600SemiBold';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
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

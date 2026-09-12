import { useWindowDimensions } from 'react-native';

import { resolverDispositivo, type Dispositivo } from './responsivo';

/**
 * El dispositivo actual, reactivo al giro y a la pantalla partida de Android.
 *
 * Vive aparte de `responsivo.ts` porque aquel no puede importar
 * `react-native`: sin ese import, Jest corre sus pruebas en Node sin
 * transformar nada. Toda la decision esta alla; aqui solo se conecta a la
 * ventana.
 *
 * `useWindowDimensions` ya re-renderiza cuando la ventana cambia, asi que
 * girar el equipo recompone el layout sin nada mas.
 */
export function useDispositivo(): Dispositivo {
  const { width, height } = useWindowDimensions();
  return resolverDispositivo(width, height);
}

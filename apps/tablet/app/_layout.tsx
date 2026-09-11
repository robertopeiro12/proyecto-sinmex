import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProveedorJawa } from '@/estado/proveedor-jawa';
import { useCabecera } from '@/ui/tema';
import { useTipografias } from '@/ui/tipografia';

/**
 * Raiz de la app.
 *
 * Aqui se abre la base local, se corren las migraciones y se lee la sesion
 * guardada (dentro de `ProveedorJawa`) antes de pintar cualquier pantalla.
 * Las tres cosas son **sincronas** a proposito: ver el comentario de
 * `src/sesion/almacen.ts` sobre por que una lectura asincrona de la sesion
 * mandaria al login a quien si la tiene.
 */
export default function LayoutRaiz() {
  // Unico punto de carga de las tipografias en toda la app: son un recurso del
  // proceso, no de una pantalla, y pedirlas dos veces no las carga dos veces
  // pero si multiplica los sitios donde alguien puede olvidarse.
  //
  // **El resultado se ignora a proposito y NO se bloquea el render.** Si los
  // `.ttf` todavia no estan, Android pinta con la tipografia del sistema y la
  // app arranca igual. Ver el comentario de `useTipografias()`: el vendedor que
  // abre la app en la banqueta con la camioneta en doble fila no puede quedarse
  // mirando una pantalla en blanco porque una fuente tardo.
  useTipografias();

  const cabecera = useCabecera();

  return (
    <SafeAreaProvider>
      <ProveedorJawa>
        <StatusBar style="dark" />
        <Stack screenOptions={cabecera}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="abrir-dia" options={{ title: 'Abrir el día' }} />
          <Stack.Screen name="(jornada)" options={{ headerShown: false }} />
        </Stack>
      </ProveedorJawa>
    </SafeAreaProvider>
  );
}

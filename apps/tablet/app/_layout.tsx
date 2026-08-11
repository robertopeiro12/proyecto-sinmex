import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProveedorJawa } from '@/estado/proveedor-jawa';
import { colores } from '@/ui/tema';

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
  return (
    <SafeAreaProvider>
      <ProveedorJawa>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colores.superficie },
            headerTintColor: colores.texto,
            contentStyle: { backgroundColor: colores.fondo },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="abrir-dia" options={{ title: 'Abrir el dia' }} />
          <Stack.Screen name="(jornada)" options={{ headerShown: false }} />
        </Stack>
      </ProveedorJawa>
    </SafeAreaProvider>
  );
}

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProveedorJawa } from '@/estado/proveedor-jawa';
import { colores } from '@/ui/tema';

/**
 * Raiz de la app.
 *
 * Aqui se abre la base local y se corren las migraciones (dentro de
 * `ProveedorJawa`) antes de pintar cualquier pantalla.
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
          <Stack.Screen name="abrir-dia" options={{ title: 'Abrir el dia' }} />
          <Stack.Screen name="(jornada)" options={{ headerShown: false }} />
        </Stack>
      </ProveedorJawa>
    </SafeAreaProvider>
  );
}

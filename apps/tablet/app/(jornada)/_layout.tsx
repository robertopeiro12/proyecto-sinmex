import { Redirect, Stack } from 'expo-router';

import { useJawa } from '@/estado/proveedor-jawa';
import { colores } from '@/ui/tema';

/**
 * Guardia del kilometraje inicial.
 *
 * > [!danger] Regla bloqueante de [[App Tablet]]
 * > "No se le permite hacer ninguna operacion hasta registrar el kilometraje
 * > del dia."
 *
 * Todo lo que cuelga de este grupo (operacion por cliente, prospectos, ruta,
 * cierre) queda detras del guardia. Se implementa aqui, en la navegacion, y no
 * pantalla por pantalla: si cada modulo tuviera que acordarse de checarlo, el
 * dia que alguien olvide hacerlo el bloqueo deja de existir en silencio.
 *
 * El guardia mira la **jornada de hoy en SQLite**, no una bandera en memoria:
 * si la app se reinicia a media manana, el vendedor vuelve donde estaba.
 */
export default function LayoutJornada() {
  const { jornada } = useJawa();

  if (!jornada) return <Redirect href="/abrir-dia" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colores.superficie },
        headerTintColor: colores.texto,
        contentStyle: { backgroundColor: colores.fondo },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Jornada' }} />
      <Stack.Screen name="operacion/index" options={{ title: 'Operacion por cliente' }} />
      <Stack.Screen name="operacion/[clienteId]/index" options={{ title: 'Cliente' }} />
      <Stack.Screen name="operacion/[clienteId]/venta" options={{ title: 'Venta' }} />
      <Stack.Screen name="operacion/[clienteId]/cobranza" options={{ title: 'Cobranza / abono' }} />
      <Stack.Screen
        name="operacion/[clienteId]/visita-sin-venta"
        options={{ title: 'Visita sin venta' }}
      />
      <Stack.Screen
        name="operacion/[clienteId]/registros"
        options={{ title: 'Merma, promocion, consumo y gastos' }}
      />
      <Stack.Screen name="prospectos" options={{ title: 'Prospectos' }} />
      <Stack.Screen name="ruta" options={{ title: 'Ruta y GPS' }} />
      <Stack.Screen name="cerrar-dia" options={{ title: 'Cerrar el dia' }} />
    </Stack>
  );
}

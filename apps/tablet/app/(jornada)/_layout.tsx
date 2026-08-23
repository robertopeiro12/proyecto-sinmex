import { Redirect, Stack } from 'expo-router';

import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { useCabecera } from '@/ui/tema';

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
 *
 * Desde T-06 hay un guardia **antes** que este: sin sesion de vendedor no hay
 * jornada que consultar. Se comprueba tambien aqui, y no solo en `app/index`,
 * porque a este grupo se puede llegar por una ruta profunda (deep link,
 * `router.replace` desde cualquier pantalla) sin pasar por el indice.
 */
export default function LayoutJornada() {
  const { vendedor } = useSesion();
  const { jornada } = useJawa();
  // Antes de los guardias: los hooks se llaman siempre, en el mismo orden.
  const cabecera = useCabecera();

  if (!vendedor) return <Redirect href="/login" />;
  if (!jornada) return <Redirect href="/abrir-dia" />;

  // Los `name` son rutas del sistema de archivos y no llevan acento; los
  // `title` son lo que lee el vendedor y si lo llevan.
  return (
    <Stack screenOptions={cabecera}>
      <Stack.Screen name="index" options={{ title: 'Jornada' }} />
      <Stack.Screen name="operacion/index" options={{ title: 'Operación por cliente' }} />
      <Stack.Screen name="operacion/[clienteId]/index" options={{ title: 'Cliente' }} />
      <Stack.Screen name="operacion/[clienteId]/venta" options={{ title: 'Venta' }} />
      <Stack.Screen name="operacion/[clienteId]/cobranza" options={{ title: 'Cobranza / abono' }} />
      <Stack.Screen
        name="operacion/[clienteId]/visita-sin-venta"
        options={{ title: 'Visita sin venta' }}
      />
      <Stack.Screen
        name="operacion/[clienteId]/registros"
        options={{ title: 'Merma, promoción, consumo y gastos' }}
      />
      <Stack.Screen name="prospectos" options={{ title: 'Prospectos' }} />
      <Stack.Screen name="ruta" options={{ title: 'Ruta y GPS' }} />
      <Stack.Screen name="cerrar-dia" options={{ title: 'Cerrar el día' }} />
    </Stack>
  );
}

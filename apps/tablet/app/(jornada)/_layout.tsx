import { Redirect, Stack, useSegments } from 'expo-router';

import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { useCabecera } from '@/ui/tema';

/**
 * Guardia del kilometraje inicial.
 *
 * Rediseño, pieza 1: ya no hay pantalla aparte para abrir el dia. Sin jornada
 * solo pasa la Ruta (`index`), que pinta la tarjeta "Empezar ruta" con los
 * clientes atenuados; cualquier otra pantalla del grupo regresa a la Ruta. Es la
 * unica barrera: `exigirJornadaAbierta` de la capa de datos NO lanza sin jornada.
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
  // `["(jornada)"]` en la Ruta; `["(jornada)", "gastos"]` etc. en las demas.
  // Se descarta un `index` por si alguna version lo reporta.
  const segmentos = useSegments();
  const enLaRuta = segmentos.slice(1).filter((s) => s !== 'index').length === 0;

  if (!vendedor) return <Redirect href="/login" />;
  if (!jornada && !enLaRuta) return <Redirect href="/(jornada)" />;

  // Los `name` son rutas del sistema de archivos y no llevan acento; los
  // `title` son lo que lee el vendedor y si lo llevan.
  return (
    <Stack screenOptions={cabecera}>
      {/* La ruta dibuja su propia cabecera: se desliza con el menu lateral (2026-10-18). */}
      <Stack.Screen name="index" options={{ title: 'Ruta del día', headerShown: false }} />
      {/* Rediseño, pieza 1 (maqueta 7): la hoja del cliente sube sobre la Ruta y se arrastra a pantalla completa. */}
      <Stack.Screen
        name="operacion/[clienteId]/index"
        options={{
          title: 'Cliente',
          presentation: 'formSheet',
          sheetAllowedDetents: [0.6, 1],
          sheetGrabberVisible: true,
          headerShown: false,
        }}
      />
      <Stack.Screen name="operacion/[clienteId]/venta" options={{ title: 'Venta' }} />
      <Stack.Screen name="operacion/[clienteId]/cobranza" options={{ title: 'Cobranza / abono' }} />
      <Stack.Screen
        name="operacion/[clienteId]/visita-sin-venta"
        options={{ title: 'Visita sin venta' }}
      />
      <Stack.Screen name="operacion/[clienteId]/merma" options={{ title: 'Merma y cambios' }} />
      <Stack.Screen name="prospectos" options={{ title: 'Prospectos', headerShown: false }} />
      <Stack.Screen name="gastos/index" options={{ title: 'Gastos', headerShown: false }} />
      <Stack.Screen name="merma/index" options={{ title: 'Merma / Cambios', headerShown: false }} />
      <Stack.Screen name="merma/registrar" options={{ title: 'Merma del vehículo' }} />
      <Stack.Screen name="inventario/index" options={{ title: 'Inventario', headerShown: false }} />
      <Stack.Screen name="inventario/[cargaId]" options={{ title: 'Carga' }} />
      {/* Pantallas del menu: dibujan su cabecera con `MarcoMenu` (se desliza con el menu). */}
      <Stack.Screen name="registros/index" options={{ title: 'Ventas / Cobranza', headerShown: false }} />
      {/* Rediseño pieza 5 (maqueta 18): el detalle de un movimiento, con "atrás"; su título lo pone la pantalla. */}
      <Stack.Screen name="registros/[tipo]/[id]" options={{ title: 'Movimiento' }} />
      <Stack.Screen name="impresora" options={{ title: 'Seleccionar impresora', headerShown: false }} />
      <Stack.Screen name="sugerido-de-carga" options={{ title: 'Sugerido de carga', headerShown: false }} />
      <Stack.Screen name="agregar-a-ruta" options={{ title: 'Agregar a mi ruta' }} />
      {/* Rediseño pieza 6 (maquetas 22–24): el corte cierra el día; con el día cerrado, lo enviado. */}
      <Stack.Screen name="corte" options={{ title: 'Corte', headerShown: false }} />
    </Stack>
  );
}

import { useLocalSearchParams } from 'expo-router';

import { esSeccionPendiente, SECCIONES_PENDIENTES } from '@/estado/ruta-del-dia';
import { PantallaPendiente } from '@/ui/pantalla-pendiente';

/**
 * Las entradas del menu hamburguesa que todavia no existen (T-37, D16): una
 * sola pantalla parametrica en vez de un archivo por seccion. El texto y el
 * ticket salen de `SECCIONES_PENDIENTES`.
 */
export default function SeccionPendiente() {
  const { seccion } = useLocalSearchParams<{ seccion: string }>();

  if (!esSeccionPendiente(seccion)) {
    return (
      <PantallaPendiente
        titulo="Sección no encontrada"
        ticket="—"
        descripcion="Esta sección del menú no existe."
      />
    );
  }

  const datos = SECCIONES_PENDIENTES[seccion];
  return (
    <PantallaPendiente titulo={datos.titulo} ticket={datos.ticket} descripcion={datos.descripcion} />
  );
}

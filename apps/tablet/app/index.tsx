import { Redirect } from 'expo-router';

import { useJawa } from '@/estado/proveedor-jawa';

/**
 * Punto de entrada: manda al vendedor a abrir el dia o, si ya lo abrio, al
 * menu de la jornada.
 *
 * TODO: T-06 — antes de esto ira la pantalla de login del vendedor con sesion
 *       valida offline.
 */
export default function Entrada() {
  const { jornada } = useJawa();
  return <Redirect href={jornada ? '/(jornada)' : '/abrir-dia'} />;
}

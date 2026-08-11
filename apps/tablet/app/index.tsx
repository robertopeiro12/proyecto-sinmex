import { Redirect } from 'expo-router';

import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';

/**
 * Punto de entrada.
 *
 * Tres puertas, en este orden:
 *
 * 1. **Sesion** (T-06) — sin vendedor autenticado no se ve nada. Se comprueba
 *    aqui y en `app/_layout.tsx`, no pantalla por pantalla.
 * 2. **Kilometraje inicial** (T-04) — sin jornada abierta, a "abrir el dia".
 *    El guardia que lo impone de verdad vive en `app/(jornada)/_layout.tsx`.
 * 3. La jornada.
 *
 * La sesion va primero porque la jornada es "la jornada DE ESTE vendedor": sin
 * saber quien es, no hay jornada que consultar.
 */
export default function Entrada() {
  const { vendedor } = useSesion();
  const { jornada } = useJawa();

  if (!vendedor) return <Redirect href="/login" />;
  return <Redirect href={jornada ? '/(jornada)' : '/abrir-dia'} />;
}

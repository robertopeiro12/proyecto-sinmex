import { Redirect } from 'expo-router';

import { useSesion } from '@/estado/proveedor-sesion';

/**
 * Punto de entrada.
 *
 * Dos puertas, en este orden:
 *
 * 1. **Sesion** (T-06) — sin vendedor autenticado no se ve nada. Se comprueba
 *    aqui y en `app/_layout.tsx`, no pantalla por pantalla.
 * 2. La Ruta, con o sin jornada (rediseño, pieza 1): sin jornada de hoy pinta
 *    la tarjeta "Empezar ruta" (vehiculo + kilometraje inicial). El guardia que
 *    impide operar sin jornada vive en `app/(jornada)/_layout.tsx`.
 *
 * La sesion va primero porque la jornada es "la jornada DE ESTE vendedor": sin
 * saber quien es, no hay jornada que consultar.
 */
export default function Entrada() {
  const { vendedor } = useSesion();

  if (!vendedor) return <Redirect href="/login" />;
  return <Redirect href="/(jornada)" />;
}

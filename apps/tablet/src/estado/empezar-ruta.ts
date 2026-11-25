import type { Vehiculo } from '@/datos/tipos';

/**
 * Empezar ruta desde la Ruta (rediseño, pieza 1; spec §4 y §16-bis), sin React.
 *
 * El candado vive en `src/datos/inventario-reglas.ts` (lo usa
 * `cargas.candadoDeHoy`, y `src/datos/` no importa de `src/estado/`); aqui se
 * reexporta junto con lo que solo es de pantalla.
 */
export { candadoDeClientes } from '@/datos/inventario-reglas';
export type { CandadoClientes } from '@/datos/inventario-reglas';

/**
 * El vehiculo que viene elegido en la tarjeta: el que eligio el vendedor si
 * sigue en la lista; si no, el que asigno el portal (`ruta_dia.vehiculo_id`) si
 * esta en la lista; si no, el primero. `null` sin vehiculos.
 *
 * Se **deriva** en cada render, no se siembra en un `useState`: la lista suele
 * llegar vacia al montar y el pull la llena despues (el defecto que tuvo
 * `abrir-dia`).
 */
export function vehiculoPorOmision(
  vehiculos: readonly Pick<Vehiculo, 'id'>[],
  asignadoId: string | null,
  elegidoId: string | null,
): string | null {
  const esta = (id: string | null) => id !== null && vehiculos.some((v) => v.id === id);
  if (esta(elegidoId)) return elegidoId;
  if (esta(asignadoId)) return asignadoId;
  return vehiculos[0]?.id ?? null;
}

/** Lo que dice el aviso de la Ruta cuando falta el inventario (maqueta 2). Boton: "Ir a inventario". */
export const TEXTO_CANDADO: Record<
  'sin-carga' | 'carga-pendiente' | 'rechazada',
  { titulo: string; texto: string }
> = {
  'carga-pendiente': {
    titulo: 'Falta aceptar tu inventario',
    texto: 'Tienes una carga esperando. Acéptala para poder vender.',
  },
  'sin-carga': {
    titulo: 'Aún no te cargan',
    texto: 'Cuando el almacén capture tu carga, aquí te avisamos para aceptarla.',
  },
  rechazada: {
    titulo: 'Rechazaste la carga',
    texto: 'Espera a que el almacén te mande una carga nueva para poder vender.',
  },
};

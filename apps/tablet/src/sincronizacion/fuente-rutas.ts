import type { RepositorioRutas } from '@/datos/repositorios/rutas';

import type { DatosRutaAlta, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/** El codigo con el que el servidor dice "la oficina ya lo tenia". */
export const CODIGO_RUTA_DUPLICADA = 'ruta-duplicada';

/**
 * Las altas de ruta del vendedor, como operaciones del push (T-37, D13).
 *
 * - **`clave`** es el id local de la fila: no cambia, y reenviar no duplica.
 * - **`fecha_operacion`** es el dia de la ruta, no otra lectura del reloj.
 * - **`datos.cliente_id`** y no `cliente_id` en el sobre: ver `DatosRutaAlta`.
 * - El orden **no viaja** (D4).
 *
 * `ruta-duplicada` **no es un error del vendedor**: la oficina ya tenia a ese
 * cliente. Se marca sincronizada y el pull posterior la funde con la fila del
 * servidor (`aplicarSnapshotRutas`). Los demas rechazos se quedan en `error` y
 * se reenvian (patron D19).
 */
export function fuenteRutas(rutas: RepositorioRutas): FuenteOperaciones {
  return {
    tipo: 'ruta-alta',

    pendientes(): OperacionSaliente[] {
      return rutas.pendientesDeSincronizar().map((r) => {
        const datos: DatosRutaAlta = { cliente_id: r.cliente_id };
        return {
          clave: r.id,
          tipo: 'ruta-alta',
          fecha_operacion: r.fecha,
          // En un alta pendiente, `sincronizado_en` es el momento de la captura.
          ocurrido_en: r.sincronizado_en,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => rutas.marcarSincronizada(clave),

    marcarError: (clave, motivo) => {
      // El motor arma el motivo como "<codigo>: <texto>" (`aplicarResultado`).
      if (motivo.split(':')[0]?.trim() === CODIGO_RUTA_DUPLICADA) {
        rutas.marcarSincronizada(clave);
        return;
      }
      rutas.marcarError(clave, motivo);
    },
  };
}

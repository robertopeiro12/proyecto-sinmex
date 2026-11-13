import type { RepositorioNotasAsignadas } from '@/datos/repositorios/notas-asignadas';

import type { DatosNotaNoCobrada, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Los comentarios de "Continuar sin cobrar" como operaciones del push.
 *
 * - **`clave`** es el `id` de la fila (uuid): idempotencia. Cada comentario es
 *   su propia fila; no se edita ni se borra.
 * - **`cliente_id`** va en el sobre, no en `datos` (como la cobranza). Sin folio.
 * - `fecha_operacion` es `nota_no_cobrada.fecha` (dia de la jornada), no UTC.
 * - Rechazos (`nota-no-encontrada`, `nota-no-cobrada-id-ocupado`): `marcarError`
 *   con el motivo, igual que el gasto.
 *
 * Va despues de cobranzas y antes de visitas. Ver `fuentes.ts`.
 */
export function fuenteNotasNoCobradas(notas: RepositorioNotasAsignadas): FuenteOperaciones {
  return {
    tipo: 'nota-no-cobrada',

    pendientes(): OperacionSaliente[] {
      return notas.pendientesDeSincronizar().map((n) => {
        const datos: DatosNotaNoCobrada = {
          venta_nota_id: n.venta_nota_id,
          comentario: n.comentario,
          registrado_en: n.registrado_en,
        };
        return {
          clave: n.id,
          tipo: 'nota-no-cobrada',
          cliente_id: n.cliente_id,
          fecha_operacion: n.fecha,
          ocurrido_en: n.registrado_en,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => notas.marcarSincronizada(clave),
    marcarError: (clave, motivo) => notas.marcarError(clave, motivo),
  };
}

import type { RepositorioGastos } from '@/datos/repositorios/gastos';

import type { DatosGasto, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Los gastos de la ruta, como operaciones del push (T-30/T-31, D5).
 *
 * - **`clave`** es el `id` de la fila: no cambia, y en el servidor es el id del
 *   gasto (asi la foto del ticket se liga a el).
 * - **Sin `cliente_id` ni folio**: un gasto no es de un cliente ni una nota que
 *   nadie firme; el servidor rechaza el sobre que los traiga.
 * - `fecha_operacion` es el dia de trabajo de la tablet (`gasto.fecha`), nunca
 *   re-derivado de UTC: un gasto a las 17:30 de Tijuana cuenta ese dia.
 * - La foto **no** viaja aqui: sube despues por su canal (`fuente-fotos.ts`).
 *
 * Va despues de visitas y antes de rutas. Ver `fuentes.ts`.
 */
export function fuenteGastos(gastos: RepositorioGastos): FuenteOperaciones {
  return {
    tipo: 'gasto',

    pendientes(): OperacionSaliente[] {
      return gastos.pendientesDeSincronizar().map((g) => {
        const datos: DatosGasto = {
          campo_egreso_id: g.campo_egreso_id,
          monto_centavos: g.monto_centavos,
          registrado_en: g.registrado_en,
          comentario: g.comentario,
        };
        return {
          clave: g.id,
          tipo: 'gasto',
          fecha_operacion: g.fecha,
          ocurrido_en: g.registrado_en,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => gastos.marcarSincronizada(clave),
    marcarError: (clave, motivo) => gastos.marcarError(clave, motivo),
  };
}

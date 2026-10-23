import type { RepositorioMovimientos } from '@/datos/repositorios/movimientos';

import type { DatosMovimiento, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Los movimientos de inventario, como operaciones del push (T-27 pieza 2, D7).
 *
 * - **`clave`** es el `id` de la fila: no cambia, y en el servidor es el id del
 *   movimiento.
 * - **`cliente_id`** solo en la merma del cliente (pasa por el alcance del lote);
 *   el servidor rechaza un consumo o una merma del trayecto que lo traiga. Sin
 *   folio.
 * - `fecha_operacion` es el dia de trabajo de la tablet (`movimiento.fecha`).
 *
 * Va despues de gastos y antes de rutas (y despues de prospectos: la merma a un
 * prospecto capturado sin red necesita su alta ya arriba). Ver `fuentes.ts`.
 */
export function fuenteMovimientos(movimientos: RepositorioMovimientos): FuenteOperaciones {
  return {
    tipo: 'movimiento',

    pendientes(): OperacionSaliente[] {
      return movimientos.pendientesDeSincronizar().map((m) => {
        const datos: DatosMovimiento = {
          tipo: m.tipo,
          comentario: m.comentario,
          registrado_en: m.registrado_en,
          lineas: m.lineas.map((l) => ({
            presentacion_id: l.presentacion_id,
            sentido: l.sentido,
            piezas: l.piezas,
          })),
        };
        const operacion: OperacionSaliente = {
          clave: m.id,
          tipo: 'movimiento',
          fecha_operacion: m.fecha,
          ocurrido_en: m.registrado_en,
          datos,
        };
        return m.cliente_id === null ? operacion : { ...operacion, cliente_id: m.cliente_id };
      });
    },

    marcarSincronizada: (clave) => movimientos.marcarSincronizada(clave),
    marcarError: (clave, motivo) => movimientos.marcarError(clave, motivo),
  };
}

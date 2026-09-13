import type { RepositorioVentas } from '@/datos/repositorios/ventas';

import type { DatosVenta, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Las ventas capturadas en ruta, como operaciones del push (T-16).
 *
 * A diferencia de la jornada, una venta se sube en cuanto se graba: no se edita
 * nunca (D3), asi que no hay nada que esperar a que quede completa.
 *
 * - **`clave`** es el `id` de la fila: no cambia, y reenviar no duplica.
 * - **`fecha_operacion`** es la fecha con la que se emitio el folio (el reloj
 *   local de la tablet). El servidor rechaza un folio cuya fecha no coincide.
 * - **`cliente_id` y `folio`** van en el sobre, no en `datos` (contrato §6).
 * - **`datos`** no lleva monto ni status: los calcula el servidor.
 *
 * Las que el servidor rechazo siguen en la cola (D19): se vuelven a mandar en
 * la siguiente sincronizacion.
 */
export function fuenteVentas(ventas: RepositorioVentas): FuenteOperaciones {
  return {
    tipo: 'venta',

    pendientes(): OperacionSaliente[] {
      return ventas.pendientesDeSincronizar().map((v) => {
        const datos: DatosVenta = {
          num_nota: v.num_nota,
          contado_credito: v.contado_credito,
          factura: v.factura,
          comentarios: v.comentarios,
          lineas: ventas.lineasDe(v.id).map((l) => ({
            presentacion_id: l.presentacion_id,
            cantidad: l.cantidad,
            cantidad_promocion: l.cantidad_promocion,
            precio_centavos: l.precio_centavos,
          })),
        };

        return {
          clave: v.id,
          tipo: 'venta',
          fecha_operacion: v.fecha,
          ocurrido_en: v.grabada_en,
          cliente_id: v.cliente_id,
          folio: v.folio,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => ventas.marcarSincronizada(clave),
    marcarError: (clave, motivo) => ventas.marcarError(clave, motivo),
  };
}

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
 * - **`firma`** (T-73): `{ nombre }` en toda venta con firma local; la imagen sube aparte (`fuenteFirmasVentas`).
 *
 * Las que el servidor rechazo siguen en la cola (D19): se vuelven a mandar en
 * la siguiente sincronizacion.
 */
export function fuenteVentas(ventas: RepositorioVentas): FuenteOperaciones {
  return {
    tipo: 'venta',

    pendientes(): OperacionSaliente[] {
      return ventas.pendientesDeSincronizar().map((v) => {
        // T-74 (D13): solo cuando hay filas. Una venta anterior a la 012 llevaba
        // piezas de promocion a mano y ninguna fila: mandar `regalos: []` haria
        // que el servidor la rechazara por no cuadrar. Sin la clave, entra como
        // siempre.
        const regalos = ventas.regalosDe(v.id);
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
          ...(regalos.length > 0
            ? {
                regalos: regalos.map((r) => ({
                  promocion_id: r.promocion_id,
                  presentacion_id: r.presentacion_id,
                  cantidad: r.cantidad,
                  texto: r.texto,
                })),
              }
            : {}),
          // T-73: presente = el servidor espera la imagen por el canal de fotos.
          // Una venta anterior a la 016 no tiene firma_local y no la manda.
          ...(v.firma_local !== null ? { firma: { nombre: v.firma_nombre } } : {}),
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

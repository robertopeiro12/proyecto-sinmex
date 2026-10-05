import type { RepositorioCobranzas } from '@/datos/repositorios/cobranzas';

import type { DatosCobranza, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Los cobros capturados en ruta, como operaciones del push (T-20).
 *
 * - **`clave`** es el `id` de la fila: no cambia, y reenviar no duplica.
 * - **`fecha_operacion`** es la fecha con la que se emitio el folio.
 * - **`cliente_id` y `folio`** van en el sobre, no en `datos` (contrato §6).
 * - **`datos`** es el pago tal cual; el reparto lo hace el servidor.
 *
 * Se registra DESPUES de la fuente de ventas: el motor sube por fuente y en
 * orden, asi que un cobro nunca llega antes que las ventas del dia. Los
 * rechazados siguen en la cola y se reenvian (patron D19 de T-16).
 */
export function fuenteCobranzas(cobranzas: RepositorioCobranzas): FuenteOperaciones {
  return {
    tipo: 'cobranza',

    pendientes(): OperacionSaliente[] {
      return cobranzas.pendientesDeSincronizar().map((c) => {
        const datos: DatosCobranza = {
          venta_nota_id: c.venta_nota_id,
          monto_centavos: c.monto_centavos,
          metodo_pago: c.metodo_pago,
          fecha_pago: c.fecha_pago,
        };

        return {
          clave: c.id,
          tipo: 'cobranza',
          fecha_operacion: c.fecha,
          ocurrido_en: c.grabada_en,
          cliente_id: c.cliente_id,
          folio: c.folio,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => cobranzas.marcarSincronizada(clave),
    marcarError: (clave, motivo) => cobranzas.marcarError(clave, motivo),
  };
}

import type { RepositorioVisitas } from '@/datos/repositorios/visitas';

import type { DatosVisita, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Las visitas sin venta, como operaciones del push (T-39, D3).
 *
 * - **`clave`** es el `id` de la fila: no cambia, y en el servidor es el id de
 *   la visita (asi la foto se liga a ella).
 * - **`cliente_id`** va en el sobre: pasa por el alcance del lote. Sin folio.
 * - La foto **no** viaja aqui: sube despues por su canal (`fuente-fotos.ts`).
 *
 * Va DESPUES de prospectos (la visita a un prospecto recien capturado necesita
 * que su alta ya este arriba) y de ventas y cobranzas. Ver `fuentes.ts`.
 */
export function fuenteVisitas(visitas: RepositorioVisitas): FuenteOperaciones {
  return {
    tipo: 'visita',

    pendientes(): OperacionSaliente[] {
      return visitas.pendientesDeSincronizar().map((v) => {
        const datos: DatosVisita = {
          motivo_visita_id: v.motivo_visita_id,
          visitada_en: v.visitada_en,
          observaciones: v.observaciones,
          atendio: v.atendio,
          lat: v.lat,
          lng: v.lng,
          precision_m: v.precision_m,
          direccion_texto: v.direccion_texto,
        };
        return {
          clave: v.id,
          tipo: 'visita',
          fecha_operacion: v.fecha,
          ocurrido_en: v.visitada_en,
          cliente_id: v.cliente_id,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => visitas.marcarSincronizada(clave),
    marcarError: (clave, motivo) => visitas.marcarError(clave, motivo),
  };
}

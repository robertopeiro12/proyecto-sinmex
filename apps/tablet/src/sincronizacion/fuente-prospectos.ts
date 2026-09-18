import type { RepositorioProspectos } from '@/datos/repositorios/prospectos';

import type { DatosProspecto, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * Los prospectos capturados en ruta, como operaciones del push (T-40).
 *
 * Como la venta y a diferencia de la jornada, un prospecto se sube en cuanto se
 * graba: no se edita nunca desde la tablet, asi que no hay nada que esperar a
 * que quede completo.
 *
 * - **`clave`** es el `id` de la fila: no cambia, y reenviar no duplica.
 * - **`fecha_operacion`** es `reloj.hoy()` del momento de la captura (hora local
 *   de Tijuana). El servidor no la re-deriva de UTC.
 * - **Sin `cliente_id`**: el prospecto no se refiere a un cliente, lo esta
 *   creando. El servidor lo proyecta a `cliente` con `tipo = 'prospecto'`.
 * - **Sin `folio`**: no es una nota que nadie firme, asi que no consume un numero
 *   del contador del dia (ADR-0001). El servidor **rechaza** un prospecto con
 *   folio, para que un bug de la tablet no queme numeros del espacio global.
 * - **`foto: null`** viaja ya, reservado: ver `DatosProspecto` en el contrato.
 *
 * Los que el servidor rechazo siguen en la cola: se vuelven a mandar en la
 * siguiente sincronizacion, que ademas les baja el catalogo nuevo — que es
 * justamente lo que arregla un `tipo-negocio-inexistente`.
 */
export function fuenteProspectos(
  prospectos: RepositorioProspectos,
): FuenteOperaciones {
  return {
    tipo: 'prospecto',

    pendientes(): OperacionSaliente[] {
      return prospectos.pendientesDeSincronizar().map((p) => {
        const datos: DatosProspecto = {
          nombre: p.nombre,
          telefono: p.telefono,
          encargado: p.encargado,
          tipo_negocio_id: p.tipo_negocio_id,
          comentarios: p.comentarios,
          lat: p.lat,
          lng: p.lng,
          foto: null,
        };

        return {
          clave: p.id,
          tipo: 'prospecto',
          fecha_operacion: p.fecha,
          ocurrido_en: p.grabado_en,
          datos,
        };
      });
    },

    marcarSincronizada: (clave) => prospectos.marcarSincronizado(clave),
    marcarError: (clave, motivo) => prospectos.marcarError(clave, motivo),
  };
}

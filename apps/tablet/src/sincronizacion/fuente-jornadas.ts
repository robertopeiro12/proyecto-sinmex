import type { RepositorioJornadas } from '@/datos/repositorios/jornadas';

import type { OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * La jornada como operacion que se sube: **vehiculo y kilometraje del dia**.
 *
 * Es el "km" del criterio de aceptacion de T-07 y la unica entidad operativa
 * que existe hoy en la tablet (T-04). Las demas —venta, cobranza, gasto, merma,
 * ruta— llegan con sus tickets y registran su propia fuente sin tocar el motor.
 *
 * > [!warning] Solo se suben las jornadas CERRADAS
 * > El buzon del servidor es **de solo escritura**: una operacion se guarda una
 * > vez y un reenvio devuelve `duplicada` sin modificar nada. Eso es
 * > exactamente lo que hace segura la idempotencia, pero significa que subir la
 * > jornada al abrirla congelaria su kilometraje inicial y el final no llegaria
 * > nunca. Como el kilometraje solo esta completo al cerrar el dia —que es
 * > ademas cuando el modelo del negocio dice que la tablet vuelve al WiFi—, se
 * > sube entonces.
 * >
 * > TODO: T-44 — la sincronizacion de las 11:00/14:00 querra subir tambien la
 * >       jornada abierta. Necesita que el contrato admita **actualizar** una
 * >       operacion ya recibida, que es justo lo que T-43 tiene que resolver
 * >       (una version por operacion, no solo una clave).
 *
 * La **clave de idempotencia es el `id` de la fila** (uuid v4 generado al abrir
 * el dia). No cambia nunca, asi que reenviar el lote no puede duplicar la
 * jornada ni el kilometraje.
 */
export function fuenteJornadas(jornadas: RepositorioJornadas): FuenteOperaciones {
  return {
    tipo: 'jornada',

    pendientes(): OperacionSaliente[] {
      return jornadas
        .pendientesDeSincronizar()
        .filter((j) => j.estado === 'cerrada')
        .map((j) => ({
          clave: j.id,
          tipo: 'jornada',
          // El dia de trabajo tal como lo calculo la tablet con su reloj local.
          // Ver `reloj.hoy()` y el ADR-0004: en UTC, a las 18:00 de Tijuana ya
          // seria el dia siguiente.
          fecha_operacion: j.fecha,
          // `cerrada_en` no puede ser null aqui: el filtro de arriba lo
          // garantiza. El `??` es por el tipo, no por el caso.
          ocurrido_en: j.cerrada_en ?? j.abierta_en,
          datos: {
            vehiculo_id: j.vehiculo_id,
            km_inicial: j.km_inicial,
            km_final: j.km_final,
            abierta_en: j.abierta_en,
            cerrada_en: j.cerrada_en,
          },
        }));
    },

    marcarSincronizada: (clave) => jornadas.marcarSincronizada(clave),
    marcarError: (clave, motivo) => jornadas.marcarError(clave, motivo),
  };
}

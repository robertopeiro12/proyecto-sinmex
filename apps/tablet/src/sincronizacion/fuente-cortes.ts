import type { Corte, RepositorioCortes } from '@/datos/repositorios/cortes';

import type { DatosCorte, OperacionSaliente } from './contrato';
import type { FuenteOperaciones } from './motor';

/**
 * El corte del vendedor como operacion del push (rediseño pieza 6, spec §13).
 *
 * - **`clave`** es el `id` de la fila del corte: no cambia, y en el servidor es
 *   el id de `corte_vendedor`. Sin folio ni `cliente_id`.
 * - `fecha_operacion` es el dia de la jornada que cerro (`corte.fecha`).
 * - Solo sube el corte **enviado** (un borrador nunca sale de
 *   `pendientesDeSincronizar`), que ya no cambia: reenviar es seguro.
 *
 * Lo que se guardo en la tablet pasa al formato del contrato (`DatosCorte`):
 * - `efectivo.esperado_centavos` = `debeTraerCentavos` del sistema (puede ser
 *   negativo); `traido_centavos` = lo capturado, **0 si quedo sin escribir**.
 * - `notas`: las del sistema, en su orden, con `traida` = palomeada.
 * - `inventario`: los renglones del sistema con lo contado (**0 si no se
 *   conto**), y despues lo contado de una presentacion que el sistema no
 *   traia, con `sistema: 0` (no se pierde nada de lo capturado).
 * - `merma`: el total del sistema y el contado (0 si quedo sin escribir).
 *
 * Va despues de movimientos y antes de rutas (`fuentes.ts`).
 */
function aDatos(corte: Corte & { sistema: NonNullable<Corte['sistema']>; enviadoEn: string }): DatosCorte {
  const { captura, sistema } = corte;
  const traidas = new Set(captura.notasTraidas);
  const delSistema = new Set(sistema.inventario.renglones.map((r) => r.presentacionId));
  return {
    efectivo: {
      esperado_centavos: sistema.efectivo.debeTraerCentavos,
      traido_centavos: captura.efectivoTraidoCentavos ?? 0,
    },
    notas: sistema.notas.map((n) => ({
      folio: n.folio,
      traida: traidas.has(n.clave),
      // Un saldo negativo (sobrepago) lo rechaza el servidor para siempre; la
      // regla ya lo deja en 0 (`notasDelCorte`), esto cubre lo ya guardado.
      saldo_centavos: Math.max(0, n.saldoCentavos),
    })),
    inventario: [
      ...sistema.inventario.renglones.map((r) => ({
        presentacion_id: r.presentacionId,
        sistema: r.sistema,
        contado: captura.inventarioContado[r.presentacionId] ?? 0,
      })),
      ...Object.entries(captura.inventarioContado)
        .filter(([id]) => !delSistema.has(id))
        .map(([id, contado]) => ({ presentacion_id: id, sistema: 0, contado })),
    ],
    merma: { sistema: Math.max(0, sistema.inventario.mermaSistema), contado: captura.mermaContada ?? 0 },
    enviado_en: corte.enviadoEn,
  };
}

export function fuenteCortes(cortes: RepositorioCortes): FuenteOperaciones {
  return {
    tipo: 'corte',

    pendientes(): OperacionSaliente[] {
      return cortes.pendientesDeSincronizar().flatMap((c) => {
        // `pendientesDeSincronizar` ya deja fuera un corte con el JSON roto
        // (sin `sistema`); esto solo estrecha el tipo.
        if (c.sistema === null || c.enviadoEn === null) return [];
        const operacion: OperacionSaliente = {
          clave: c.id,
          tipo: 'corte',
          fecha_operacion: c.fecha,
          ocurrido_en: c.enviadoEn,
          datos: aDatos({ ...c, sistema: c.sistema, enviadoEn: c.enviadoEn }),
        };
        return [operacion];
      });
    },

    marcarSincronizada: (clave) => cortes.marcarSincronizada(clave),
    marcarError: (clave, motivo) => cortes.marcarError(clave, motivo),
  };
}

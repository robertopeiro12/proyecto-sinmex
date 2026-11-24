import { motivoBloqueoVenta, porAtender, type NotaAsignadaDeHoy } from '@/datos/notas-asignadas-reglas';
import type { CandadoClientes } from '@/datos/inventario-reglas';
import { pesos } from '@/ui/pesos';

/**
 * Los botones de la hoja del cliente (rediseño, pieza 1; spec §6, maqueta 7),
 * sin React: la tablet no tiene pruebas de pantalla.
 */
export interface AccionesCliente {
  /** `nota` va debajo del boton: por que esta apagado, o el aviso del prospecto. */
  vender: { habilitado: boolean; nota: string | null };
  /**
   * `null` = no hay nada que cobrar (o es prospecto). `principal` = hay una
   * asignada por atender: va primero, a lo ancho y destacado. Se apaga con el
   * resto de las acciones (`visita.habilitado` dice si se puede operar).
   */
  cobrar: { visible: boolean; principal: boolean; nota: string } | null;
  visita: { habilitado: boolean };
  merma: { habilitado: boolean };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Que se puede hacer con el cliente.
 *
 * - Con candado (sin ruta empezada o sin inventario aceptado) o con el dia
 *   cerrado, nada.
 * - **Vender** se apaga con "Cobra primero" mientras una asignada traiga una
 *   condicion sin cumplir (`motivoBloqueoVenta`), aunque siga por atender: se
 *   enciende al grabar el cobro que la cumple. Es un cambio respecto de la ficha
 *   vieja (`venderDesdeFicha(...).bloqueo` no bloqueaba con notas por atender);
 *   el destino sigue saliendo de `venderDesdeFicha(...).destino`.
 * - **Cobrar** sale con cualquier nota con saldo (asignada o no), nunca al
 *   prospecto.
 */
export function accionesCliente({
  asignadas,
  notasConSaldo,
  esProspecto,
  operacionesHabilitadas,
  candado,
}: {
  asignadas: readonly NotaAsignadaDeHoy[];
  notasConSaldo: number;
  esProspecto: boolean;
  operacionesHabilitadas: boolean;
  candado: CandadoClientes;
}): AccionesCliente {
  const activo = candado === null && operacionesHabilitadas;
  const bloqueoVenta = motivoBloqueoVenta([...asignadas]);
  const pendientes = porAtender([...asignadas]);

  let cobrar: AccionesCliente['cobrar'] = null;
  if (!esProspecto && (notasConSaldo > 0 || pendientes.length > 0)) {
    const principal = pendientes.length > 0;
    const nota = principal
      ? `${plural(pendientes.length, 'nota asignada', 'notas asignadas')} · ${pesos(
          pendientes.reduce((s, n) => s + n.saldoCentavos, 0),
        )}`
      : plural(notasConSaldo, 'nota pendiente', 'notas pendientes');
    cobrar = { visible: true, principal, nota };
  }

  return {
    vender: {
      habilitado: activo && bloqueoVenta === null,
      nota: bloqueoVenta !== null ? 'Cobra primero' : esProspecto ? 'Solo regalo de bienvenida' : null,
    },
    cobrar,
    visita: { habilitado: activo },
    merma: { habilitado: activo },
  };
}

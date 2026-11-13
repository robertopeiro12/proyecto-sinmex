import {
  errorDeComentario,
  motivoBloqueoVenta,
  type NotaAsignadaDeHoy,
} from '@/datos/notas-asignadas-reglas';

import { crearGuardiaRegistro, type GuardiaRegistro } from './movimiento';

/**
 * Lo que deciden las pantallas de notas asignadas (spec 2026-11-13), sin React:
 * la tablet no tiene pruebas de pantalla, asi que las pantallas solo llaman aqui.
 */

export type DestinoVender = { tipo: 'venta' } | { tipo: 'notas'; siguiente: 'venta' };

/**
 * Al tocar "Vender": si hay notas por atender (`porAtender`) y el vendedor aun
 * no las vio en esta visita, primero la pantalla de notas.
 */
export function destinoAlVender(porAtender: NotaAsignadaDeHoy[], yaVistasEnEstaVisita: boolean): DestinoVender {
  return porAtender.length > 0 && !yaVistasEnEstaVisita ? { tipo: 'notas', siguiente: 'venta' } : { tipo: 'venta' };
}

/**
 * Tras "Continuar sin cobrar": con la condicion sin cumplir se vuelve a la
 * ficha con el motivo; si no, se sigue a la venta (si venia de ella).
 */
export function despuesDeContinuar(
  notas: NotaAsignadaDeHoy[],
  siguiente: 'venta' | null,
): { tipo: 'venta' } | { tipo: 'ficha'; motivo: string | null } {
  const motivo = motivoBloqueoVenta(notas);
  if (motivo === null && siguiente === 'venta') return { tipo: 'venta' };
  return { tipo: 'ficha', motivo };
}

/** Los mismos mensajes que el repositorio (`errorDeComentario`); `null` = sirve. */
export function validarComentario(texto: string): string | null {
  return errorDeComentario(texto);
}

/** Guardia contra el doble toque en "Continuar sin cobrar" (misma de T-39). */
export function crearGuardiaComentario(): GuardiaRegistro {
  return crearGuardiaRegistro();
}

import {
  errorDeComentario,
  ETIQUETA_CONDICION,
  motivoBloqueoVenta,
  porAtender,
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

/**
 * El boton "Vender" de la ficha: a donde lleva y, si no deja vender, por que.
 * Con notas por atender no se deshabilita: la pantalla de la nota es la que
 * ofrece cobrar o comentar. Sin por atender y con la condicion sin cumplir
 * (p. ej. un abono parcial a una que debe liquidar), queda deshabilitado con
 * el motivo.
 */
export function venderDesdeFicha(notas: NotaAsignadaDeHoy[]): {
  destino: DestinoVender;
  bloqueo: string | null;
} {
  const pendientes = porAtender(notas);
  return {
    destino: destinoAlVender(pendientes, false),
    bloqueo: pendientes.length > 0 ? null : motivoBloqueoVenta(notas),
  };
}

/**
 * Cobrar: las notas del cliente en dos grupos, "Asignadas a ti" (con su
 * condicion en pantalla) y "Otras notas del cliente", sin cambiar su orden.
 */
export function agruparNotasParaCobrar<N extends { id: string }>(
  notas: N[],
  asignadas: NotaAsignadaDeHoy[],
): { asignadas: { nota: N; etiqueta: string | null }[]; otras: N[] } {
  const condicion = new Map(asignadas.map((a) => [a.ventaNotaId, a.condicion]));
  const grupos: { asignadas: { nota: N; etiqueta: string | null }[]; otras: N[] } = { asignadas: [], otras: [] };
  for (const nota of notas) {
    const c = condicion.get(nota.id);
    if (c === undefined) grupos.otras.push(nota);
    else grupos.asignadas.push({ nota, etiqueta: ETIQUETA_CONDICION[c] });
  }
  return grupos;
}

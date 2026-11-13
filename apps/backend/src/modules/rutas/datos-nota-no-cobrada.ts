import { esInstante } from './datos-jornada';
import { RE_UUID } from './datos-visita';

/**
 * Validacion y normalizacion de `datos` de una nota no cobrada: el comentario
 * "no cobre" que el vendedor deja sobre una nota asignada.
 *
 * Pura, sin base de datos: decide la FORMA. Que la nota exista y sea del
 * cliente y la sucursal del sobre lo decide `NotasNoCobradasService`.
 */

export const LARGO_MAX_COMENTARIO_NOTA_NO_COBRADA = 300;

/** Id, vendedor, sucursal, cliente y fecha viajan en el contexto, no aqui. */
export interface NotaNoCobradaNormalizada {
  /** uuid en minusculas. */
  ventaNotaId: string;
  /** Recortado, de 1 a 300 caracteres. */
  comentario: string;
  /** ISO-8601 en UTC (`toISOString`). */
  registradoEn: string;
}

export type ResultadoDatosNotaNoCobrada =
  | { ok: true; nota: NotaNoCobradaNormalizada }
  /** El `motivo` empieza por el campo: es lo que guarda la tablet en `sync_error`. */
  | { ok: false; motivo: string };

export function normalizarDatosNotaNoCobrada(
  datos: unknown,
): ResultadoDatosNotaNoCobrada {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) {
    return { ok: false, motivo: 'datos: tiene que ser un objeto.' };
  }
  const d = datos as Record<string, unknown>;

  const ventaNotaId = d.venta_nota_id;
  if (typeof ventaNotaId !== 'string' || !RE_UUID.test(ventaNotaId)) {
    return {
      ok: false,
      motivo: 'venta_nota_id: tiene que ser el uuid de la nota.',
    };
  }

  const comentario = d.comentario;
  if (typeof comentario !== 'string') {
    return { ok: false, motivo: 'comentario: tiene que ser texto.' };
  }
  const limpio = comentario.trim();
  if (limpio === '') {
    return { ok: false, motivo: 'comentario: no puede ir vacío.' };
  }
  if (limpio.length > LARGO_MAX_COMENTARIO_NOTA_NO_COBRADA) {
    return {
      ok: false,
      motivo: `comentario: no puede pasar de ${LARGO_MAX_COMENTARIO_NOTA_NO_COBRADA} caracteres.`,
    };
  }

  const registradoEn = d.registrado_en;
  if (!esInstante(registradoEn)) {
    return {
      ok: false,
      motivo:
        'registrado_en: tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-11-13T18:40:00Z).',
    };
  }

  return {
    ok: true,
    nota: {
      ventaNotaId: ventaNotaId.toLowerCase(),
      comentario: limpio,
      registradoEn: new Date(registradoEn).toISOString(),
    },
  };
}

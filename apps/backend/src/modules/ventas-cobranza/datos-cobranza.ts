/**
 * Validacion y normalizacion de `datos` de una cobranza (T-20, D14).
 *
 * Pura, sin base de datos: decide si el cobro tiene la FORMA correcta. Que la
 * nota exista y sea del cliente lo decide `CobranzasService` dentro de la
 * transaccion.
 *
 * Recibe un objeto sin tipar y no un DTO por la regla de T-07: se rechaza por
 * operacion con un motivo, nunca se tumba el lote. Por eso tambien comprueba
 * lo que haria reventar a Postgres (un uuid mal formado, un importe que no cabe,
 * una fecha que no existe): eso seria un 500 para todo el lote, y la tablet
 * traduce un 5xx a "sin red" y reintentaria para siempre.
 */

/** Catalogo confirmado por el cliente ([[Cobranza-Abono]]). */
export type MetodoPago = 'efectivo' | 'transferencia' | 'cheque';

export const METODOS_PAGO: readonly MetodoPago[] = [
  'efectivo',
  'transferencia',
  'cheque',
];

/** `numeric(12,2)` expresado en centavos: lo que cabe en `cobranza_abono.monto`. */
export const MAX_CENTAVOS_COBRO = 999_999_999_999;

/** El cobro ya validado. El folio no va aqui: viaja en el `contexto`. */
export interface CobranzaNormalizada {
  /** uuid en minusculas, el del sobre. */
  clienteId: string;
  /** uuid en minusculas: la nota que eligio el vendedor. */
  ventaNotaId: string;
  montoCentavos: number;
  metodoPago: MetodoPago;
  /** `AAAA-MM-DD`, informativa (D3). */
  fechaPago: string;
}

export type ResultadoDatosCobranza =
  | { ok: true; cobranza: CobranzaNormalizada }
  | {
      ok: false;
      /** El campo que fallo. */
      campo: string;
      /** Empieza por `campo`: es lo que guarda la tablet en `sync_error`. */
      motivo: string;
    };

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function invalido(campo: string, motivo: string): ResultadoDatosCobranza {
  return { ok: false, campo, motivo: `${campo}: ${motivo}` };
}

function esUnoDe<T extends string>(
  valor: unknown,
  opciones: readonly T[],
): valor is T {
  return (
    typeof valor === 'string' && (opciones as readonly string[]).includes(valor)
  );
}

/**
 * `AAAA-MM-DD` que existe en el calendario.
 *
 * `Date.UTC` aqui solo sirve para comprobar el calendario (un 30 de febrero se
 * desborda a marzo); no deriva ningun dia de trabajo de UTC.
 */
function esFechaReal(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !RE_FECHA.test(valor)) return false;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

/**
 * Valida y normaliza `datos` de una operacion `cobranza`.
 *
 * `fechaOperacion` ya viene validada por `normalizarOperacion`; aqui solo se
 * compara como texto, que para `AAAA-MM-DD` es comparar fechas.
 */
export function normalizarDatosCobranza(
  clienteId: string | null,
  fechaOperacion: string,
  datos: Record<string, unknown>,
): ResultadoDatosCobranza {
  if (clienteId === null) {
    return invalido(
      'cliente_id',
      'una cobranza necesita el cliente en el sobre.',
    );
  }

  const ventaNotaId = datos.venta_nota_id;
  if (typeof ventaNotaId !== 'string' || !RE_UUID.test(ventaNotaId)) {
    return invalido(
      'venta_nota_id',
      'tiene que ser el uuid de la nota que se cobra.',
    );
  }

  const monto = datos.monto_centavos;
  if (
    typeof monto !== 'number' ||
    !Number.isInteger(monto) ||
    monto < 1 ||
    monto > MAX_CENTAVOS_COBRO
  ) {
    return invalido(
      'monto_centavos',
      `tiene que ser un entero de centavos entre 1 y ${MAX_CENTAVOS_COBRO}.`,
    );
  }

  const metodoPago = datos.metodo_pago;
  if (!esUnoDe(metodoPago, METODOS_PAGO)) {
    return invalido(
      'metodo_pago',
      'tiene que ser efectivo, transferencia o cheque.',
    );
  }

  const fechaPago = datos.fecha_pago;
  if (!esFechaReal(fechaPago)) {
    return invalido(
      'fecha_pago',
      'tiene que ser una fecha AAAA-MM-DD que exista.',
    );
  }
  if (fechaPago > fechaOperacion) {
    return invalido('fecha_pago', 'no puede ser posterior a fecha_operacion.');
  }

  return {
    ok: true,
    cobranza: {
      clienteId: clienteId.toLowerCase(),
      ventaNotaId: ventaNotaId.toLowerCase(),
      montoCentavos: monto,
      metodoPago,
      fechaPago,
    },
  };
}

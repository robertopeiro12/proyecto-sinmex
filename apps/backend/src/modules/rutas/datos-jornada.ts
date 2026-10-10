/**
 * Validacion y normalizacion de `datos` de una jornada cerrada (T-38, D2).
 *
 * Pura, sin base de datos: decide si la jornada tiene la FORMA correcta. Que el
 * vehiculo exista y sea de la sucursal del vendedor, y que el vendedor no tenga
 * ya otra jornada ese dia, lo decide `JornadasService` dentro de la transaccion.
 *
 * Recibe un objeto sin tipar y no un DTO por la regla de T-07: se rechaza por
 * operacion con un motivo, nunca se tumba el lote. Por eso tambien comprueba lo
 * que haria reventar a Postgres (un uuid mal formado, un km que no cabe en
 * `numeric(10,1)`, un instante que no existe): eso seria un 500 para todo el
 * lote, y la tablet traduce un 5xx a "sin red" y reintentaria para siempre.
 */

/** Lo que cabe en `jornada.km_*`, `numeric(10,1)`: nueve digitos enteros y una decima. */
export const KM_MAXIMO = 999_999_999.9;

/** La jornada ya validada. Vendedor, sucursal y fecha viajan en el `contexto`. */
export interface JornadaNormalizada {
  /** uuid en minusculas (Postgres los devuelve asi). */
  vehiculoId: string;
  kmInicial: number;
  kmFinal: number;
  /** ISO-8601 en UTC (`toISOString`). */
  abiertaEn: string;
  /** ISO-8601 en UTC (`toISOString`). */
  cerradaEn: string;
}

export type ResultadoDatosJornada =
  | { ok: true; jornada: JornadaNormalizada }
  | {
      ok: false;
      /**
       * `forma`: falta un campo o no tiene el tipo correcto (un bug de la
       * tablet). `km`: la forma es buena pero el km final es menor al inicial.
       * Son dos codigos distintos del contrato (D3).
       */
      falla: 'forma' | 'km';
      /** Empieza por el campo: es lo que guarda la tablet en `sync_error`. */
      motivo: string;
    };

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Instante ISO-8601 **con zona** (`Z` o `±hh:mm`). Sin zona, Postgres lo
 * leeria en la zona de su sesion y el instante se correria horas.
 */
const RE_INSTANTE =
  /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

function forma(campo: string, motivo: string): ResultadoDatosJornada {
  return { ok: false, falla: 'forma', motivo: `${campo}: ${motivo}` };
}

function esKm(valor: unknown): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isFinite(valor) &&
    valor >= 0 &&
    valor <= KM_MAXIMO
  );
}

/**
 * `AAAA-MM-DD` que existe en el calendario. `Date.parse` no basta: convierte
 * un 30 de febrero en 2 de marzo, y Postgres lo rechazaria con un 500.
 * `Date.UTC` aqui solo comprueba el calendario; no deriva ningun dia de UTC.
 */
function esFechaReal(valor: string): boolean {
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

function esInstante(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const partes = RE_INSTANTE.exec(valor);
  return (
    partes !== null &&
    esFechaReal(partes[1]) &&
    !Number.isNaN(Date.parse(valor))
  );
}

/** Valida y normaliza `datos` de una operacion `jornada`. */
export function normalizarDatosJornada(
  datos: Record<string, unknown>,
): ResultadoDatosJornada {
  const vehiculoId = datos.vehiculo_id;
  if (typeof vehiculoId !== 'string' || !RE_UUID.test(vehiculoId)) {
    return forma(
      'vehiculo_id',
      'tiene que ser el uuid del vehículo con el que se abrió el día.',
    );
  }

  const kmInicial = datos.km_inicial;
  if (!esKm(kmInicial)) {
    return forma(
      'km_inicial',
      `tiene que ser un número entre 0 y ${KM_MAXIMO}.`,
    );
  }

  const kmFinal = datos.km_final;
  if (!esKm(kmFinal)) {
    return forma('km_final', `tiene que ser un número entre 0 y ${KM_MAXIMO}.`);
  }

  const abiertaEn = datos.abierta_en;
  if (!esInstante(abiertaEn)) {
    return forma(
      'abierta_en',
      'tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-10-10T08:03:53Z).',
    );
  }

  const cerradaEn = datos.cerrada_en;
  if (!esInstante(cerradaEn)) {
    return forma(
      'cerrada_en',
      'tiene que ser un instante ISO-8601 con zona (por ejemplo 2026-10-10T18:19:55Z).',
    );
  }

  // Despues de la forma a proposito: los dos km solo se comparan si los dos son
  // legibles. El odometro no retrocede; la tablet ya lo impide al cerrar.
  if (kmFinal < kmInicial) {
    return {
      ok: false,
      falla: 'km',
      motivo: `km_final: ${kmFinal} es menor que km_inicial ${kmInicial}; el odómetro no retrocede.`,
    };
  }

  return {
    ok: true,
    jornada: {
      vehiculoId: vehiculoId.toLowerCase(),
      kmInicial,
      kmFinal,
      abiertaEn: new Date(abiertaEn).toISOString(),
      cerradaEn: new Date(cerradaEn).toISOString(),
    },
  };
}

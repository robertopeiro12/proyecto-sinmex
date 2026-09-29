import type { AbonoNota, FechaISO, MetodoPago } from './tipos';

/**
 * Reglas de la cobranza (T-20), sin SQLite ni React.
 *
 * > [!warning] `repartirPago` esta duplicada a proposito
 * > Es copia de `apps/backend/src/modules/ventas-cobranza/reglas-cobranza.ts`
 * > (la tablet no puede importar del backend: Metro), con la misma tabla de
 * > casos de prueba. La tablet reparte al grabar para descontar el saldo sin
 * > red; el servidor vuelve a repartir al proyectar. Si divergen, el saldo local
 * > parpadea hasta el pull. Si cambias una, cambia la otra en el mismo commit.
 *
 * `problemasDeCobro` la usan la pantalla (avisos antes de revisar) y el
 * repositorio (que vuelve a validar antes de grabar).
 */

/** `numeric(12,2)` en centavos: lo que el servidor acepta en `monto_centavos`. */
export const MAX_CENTAVOS_COBRO = 999_999_999_999;

export type TipoAbono = 'cobranza' | 'abono';

/** Una nota del cliente tal como la ve el reparto. */
export interface NotaParaReparto {
  id: string;
  /** `AAAA-MM-DD`: el orden del excedente es por fecha y luego por folio. */
  fecha: string;
  folio: string;
  /** Solo `pendiente`/`abonado` y viva (D8, D9). */
  cobrable: boolean;
  saldoCentavos: number;
}

/** Lo que el pago deja en una nota. */
export interface Aplicacion {
  notaId: string;
  montoCentavos: number;
  saldoAntesCentavos: number;
  /** Es la foto que se guarda en `cobranza_abono.saldo_pendiente` (D7). */
  saldoDespuesCentavos: number;
  /** `cobranza` si la deja en 0; `abono` si no (D8). */
  tipo: TipoAbono;
  status: 'pagada' | 'abonado';
}

export interface Reparto {
  /** En orden: la elegida primero y despues las demas por fecha y folio. */
  aplicaciones: Aplicacion[];
  /** Lo que no cupo en ninguna nota (D1 paso 3). */
  saldoFavorCentavos: number;
}

function porFechaYFolio(a: NotaParaReparto, b: NotaParaReparto): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.folio !== b.folio) return a.folio < b.folio ? -1 : 1;
  // El id solo desempata para que el orden sea determinista.
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Reparte un pago (D1): primero la nota elegida hasta su saldo, despues las
 * otras notas cobrables del cliente de la mas vieja a la mas nueva (`fecha`,
 * luego `folio`), y lo que sobre queda como saldo a favor.
 *
 * Un pago mayor al saldo se acepta (Mario). Una nota elegida que ya no es
 * cobrable (D9) no recibe nada y todo el monto pasa a las demas.
 *
 * @throws {Error} si `montoCentavos` no es un entero positivo: la forma del
 * pago ya la valido quien llama, asi que llegar aqui con eso es un bug.
 */
export function repartirPago(
  montoCentavos: number,
  notaElegidaId: string,
  notas: readonly NotaParaReparto[],
): Reparto {
  if (!Number.isSafeInteger(montoCentavos) || montoCentavos <= 0) {
    throw new Error(
      `repartirPago necesita un entero positivo de centavos, no ${montoCentavos}.`,
    );
  }

  const elegida = notas.find((n) => n.id === notaElegidaId);
  const otras = notas
    .filter((n) => n.id !== notaElegidaId)
    .sort(porFechaYFolio);
  const orden = elegida ? [elegida, ...otras] : otras;

  const aplicaciones: Aplicacion[] = [];
  let restante = montoCentavos;

  for (const n of orden) {
    if (restante === 0) break;
    if (!n.cobrable || n.saldoCentavos <= 0) continue;

    const monto = Math.min(restante, n.saldoCentavos);
    const despues = n.saldoCentavos - monto;
    aplicaciones.push({
      notaId: n.id,
      montoCentavos: monto,
      saldoAntesCentavos: n.saldoCentavos,
      saldoDespuesCentavos: despues,
      tipo: despues === 0 ? 'cobranza' : 'abono',
      status: despues === 0 ? 'pagada' : 'abonado',
    });
    restante -= monto;
  }

  return { aplicaciones, saldoFavorCentavos: restante };
}

/**
 * Texto del campo de monto a centavos, **sin coma flotante**.
 *
 * Solo digitos con punto y hasta 2 decimales: `150`, `150.5`, `150.50`. Una
 * coma, un signo o un tercer decimal son `null` — un "1,50" no puede volverse
 * $150 ni $1.50 en silencio.
 */
export function leerMontoCentavos(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const [enteros = '0', decimales = ''] = limpio.split('.');
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** Los abonos guardados en `nota_pendiente.abonos_json`. Un texto corrupto da `[]`. */
export function leerAbonos(json: string): AbonoNota[] {
  try {
    const valor: unknown = JSON.parse(json);
    return Array.isArray(valor) ? (valor as AbonoNota[]) : [];
  } catch {
    return [];
  }
}

export interface CapturaCobro {
  /** Fecha de la nota elegida, o `null` si aun no eligio. */
  notaFecha: FechaISO | null;
  /** De `leerMontoCentavos`: `null` si el texto no se entiende. */
  montoCentavos: number | null;
  metodoPago: MetodoPago | null;
  /** Tal cual la escribio, `AAAA-MM-DD`. */
  fechaPago: string;
  /** `reloj.hoy()` de la tablet. */
  hoy: FechaISO;
}

function esFechaReal(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [anio = 0, mes = 0, dia = 0] = texto.split('-').map(Number);
  // Solo comprueba el calendario (un 30 de febrero se desborda); no deriva
  // ningun dia de trabajo de UTC.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

/**
 * Lo que impide grabar el cobro, en el espanol del vendedor. Vacio: se puede.
 *
 * Espejo de `normalizarDatosCobranza` del servidor, mas la regla que solo la
 * tablet aplica sin consultar: la fecha de pago va de la fecha de la nota a hoy
 * (D4).
 */
export function problemasDeCobro(captura: CapturaCobro): string[] {
  const problemas: string[] = [];

  if (captura.notaFecha === null) {
    problemas.push('Elige la nota que paga.');
  }

  const monto = captura.montoCentavos;
  if (monto === null || !Number.isInteger(monto) || monto <= 0) {
    problemas.push('Captura el monto cobrado, mayor que $0.00.');
  } else if (monto > MAX_CENTAVOS_COBRO) {
    problemas.push('El monto es demasiado grande.');
  }

  if (captura.metodoPago === null) {
    problemas.push('Elige el método de pago.');
  }

  const fechaPago = captura.fechaPago.trim();
  if (!esFechaReal(fechaPago)) {
    problemas.push('La fecha de pago tiene que ser una fecha AAAA-MM-DD que exista.');
  } else if (fechaPago > captura.hoy) {
    problemas.push('La fecha de pago no puede ser posterior a hoy.');
  } else if (captura.notaFecha !== null && fechaPago < captura.notaFecha) {
    problemas.push('La fecha de pago no puede ser anterior a la fecha de la nota.');
  }

  return problemas;
}

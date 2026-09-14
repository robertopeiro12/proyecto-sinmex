/**
 * Reglas puras de la cobranza (T-20), sin base de datos ni Nest.
 *
 * > [!warning] Duplicado a proposito en la tablet
 * > `repartirPago` y sus tipos viven tambien en
 * > `apps/tablet/src/datos/cobranzas-reglas.ts`, con el mismo codigo y la misma
 * > tabla de casos de prueba. La tablet reparte localmente al grabar el cobro
 * > (para descontar el saldo sin red) y el servidor vuelve a repartir al
 * > proyectar; si divergen, el saldo de la tablet parpadea hasta el pull. La
 * > tablet no puede importar del backend (Metro): si cambias uno, cambia el
 * > otro en el mismo commit.
 */

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

/** Una nota recibe dinero solo si esta `pendiente` o `abonado` y no esta borrada (D8, D9). */
export function esCobrable(status: string, borrada: boolean): boolean {
  return !borrada && (status === 'pendiente' || status === 'abonado');
}

/**
 * La verdad del saldo (D7): monto total menos lo abonado en vivo.
 *
 * Nunca negativo: si datos viejos tienen abonos por encima del total, la nota
 * simplemente no tiene saldo; el excedente de hoy no se come ese descuadre.
 */
export function saldoDerivadoCentavos(
  montoTotalCentavos: number,
  abonadoCentavos: number,
): number {
  return Math.max(0, montoTotalCentavos - abonadoCentavos);
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
 * Un pago mayor al saldo **se acepta** (Mario). Una nota elegida que ya no es
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

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
 *
 * `repartirPagoEnNotas` (varias notas elegidas, T-21) existe SOLO aqui: el
 * portal no reparte localmente (pide la vista previa al servidor) y la tablet
 * sigue cobrando una nota a la vez. `repartirPago` es `repartirPagoEnNotas` con
 * una sola nota y da exactamente lo mismo que la copia de la tablet.
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
  /** En orden: las elegidas primero (por fecha y folio) y despues las demas por fecha y folio. */
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
 * Reparte un pago entre una o varias notas elegidas (D1, T-21): primero las
 * elegidas de la mas vieja a la mas nueva (`fecha`, luego `folio`), despues
 * las otras notas cobrables del cliente en el mismo orden, y lo que sobre
 * queda como saldo a favor.
 *
 * Un pago mayor al saldo **se acepta** (Mario). Una elegida que ya no es
 * cobrable (D9) no recibe nada y su parte sigue el orden; rechazarla o no es
 * decision de quien llama (la tablet no rechaza; el portal si, antes).
 *
 * @throws {Error} si `montoCentavos` no es un entero positivo: la forma del
 * pago ya la valido quien llama, asi que llegar aqui con eso es un bug.
 */
export function repartirPagoEnNotas(
  montoCentavos: number,
  notasElegidasIds: readonly string[],
  notas: readonly NotaParaReparto[],
): Reparto {
  if (!Number.isSafeInteger(montoCentavos) || montoCentavos <= 0) {
    throw new Error(
      `repartirPagoEnNotas necesita un entero positivo de centavos, no ${montoCentavos}.`,
    );
  }

  const elegidas = new Set(notasElegidasIds);
  const orden = [
    ...notas.filter((n) => elegidas.has(n.id)).sort(porFechaYFolio),
    ...notas.filter((n) => !elegidas.has(n.id)).sort(porFechaYFolio),
  ];

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
 * Reparte un pago sobre UNA nota elegida (D1): la de la tablet. Es
 * `repartirPagoEnNotas` con una sola nota; su copia en la tablet
 * (`apps/tablet/src/datos/cobranzas-reglas.ts`) da lo mismo.
 *
 * @throws {Error} si `montoCentavos` no es un entero positivo.
 */
export function repartirPago(
  montoCentavos: number,
  notaElegidaId: string,
  notas: readonly NotaParaReparto[],
): Reparto {
  return repartirPagoEnNotas(montoCentavos, [notaElegidaId], notas);
}

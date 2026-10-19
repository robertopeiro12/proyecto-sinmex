/**
 * T-28 — el calculo del saldo de Tesoreria, en UN solo lugar.
 *
 * Un saldo fijado es el saldo real de una cuenta al INICIO de su dia (spec §3.3):
 * el primero es el saldo inicial y los siguientes son "modificar saldo", un nuevo
 * punto de partida. T-28 no tiene movimientos; T-29 alimentara `movimientos`
 * (depositos, retiros, traspasos, cobranza; T-30/T-31, los gastos de la ruta (`GastoDia`)) sin cambiar esta firma.
 *
 * Todo en centavos enteros: nunca flotantes (ver sincronizacion/dinero.ts).
 */

/** ±999,999,999,999.99: lo que cabe en `numeric(14,2)`. */
export const MAX_CENTAVOS_TESORERIA = 99_999_999_999_999;

import {
  destinoDe,
  type CobranzaDia,
  type DestinoCobranza,
  type MetodoCobranza,
} from './reglas-destino';

export type Momento = 'inicio' | 'final';

export interface BaseSaldo {
  cuentaId: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  montoCentavos: number;
}

export interface MovimientoSaldo {
  cuentaId: string;
  fecha: string;
  /** Con signo: positivo entra, negativo sale. */
  montoCentavos: number;
}

export interface CuentaEnAlcance {
  id: string;
  nombre: string;
  /** `null` = cuenta general (de toda la empresa). */
  sucursalId: string | null;
  sucursalCodigo: string | null;
}

export interface SaldoFijado extends BaseSaldo {
  id: string;
  cuentaNombre: string;
  sucursalCodigo: string | null;
  comentario: string | null;
  /** Nombre del usuario que lo capturo. */
  capturo: string;
}

export interface CuentaEnVista {
  id: string;
  nombre: string;
  sucursalCodigo: string | null;
  saldoInicioCentavos: number | null;
  saldoFinalCentavos: number | null;
  /** Movimientos del rango que cuentan para el final (desde el saldo fijado que usa). */
  entradasCentavos: number;
  salidasCentavos: number;
  /** Fecha del saldo fijado que usa el final si cae en (desde, hasta]; si no, null. */
  saldoFijadoEnRango: string | null;
}

/**
 * T-30/T-31 (D7): los gastos de la ruta de un dia y una sucursal, ya sumados.
 * Solo los de `metodo = METODO_GASTO_RUTA`: salen del efectivo que cobro
 * el vendedor, asi que restan de la MISMA cuenta a la que T-29 suma la cobranza
 * en efectivo de esa sucursal (la vigente de `(sucursal, 'efectivo')` en la
 * fecha del gasto).
 */
export interface GastoDia {
  /** `AAAA-MM-DD`: la `fecha_operacion` del gasto, nunca re-derivada de UTC. */
  fecha: string;
  sucursalId: string;
  sucursalCodigo: string;
  /** Cuantos gastos forman la suma. */
  cantidad: number;
  /** Positivo: el signo lo pone `movimientosDeSaldo`. */
  montoCentavos: number;
}

export type TipoMovimiento = 'deposito' | 'retiro' | 'traspaso';

export interface MovimientoManual {
  id: string;
  tipo: TipoMovimiento;
  fecha: string;
  /** Siempre positivo: el tipo dice si suma o resta. */
  montoCentavos: number;
  cuentaId: string;
  cuentaNombre: string;
  cuentaDestinoId: string | null;
  cuentaDestinoNombre: string | null;
  comentario: string | null;
  capturo: string;
}

export type EventoTesoreria =
  | {
      tipo: 'saldo-fijado';
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      montoCentavos: number;
      comentario: string | null;
      capturo: string;
    }
  | {
      tipo: 'deposito' | 'retiro';
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      montoCentavos: number;
      comentario: string | null;
      capturo: string;
    }
  | {
      tipo: 'traspaso';
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      cuentaDestinoId: string;
      cuentaDestinoNombre: string;
      montoCentavos: number;
      comentario: string | null;
      capturo: string;
    }
  | {
      tipo: 'cobranza';
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      sucursalCodigo: string;
      metodo: MetodoCobranza;
      cantidad: number;
      montoCentavos: number;
    }
  | {
      /** T-30/T-31: el total de gastos de la ruta de un dia y una sucursal. */
      tipo: 'gasto-ruta';
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      sucursalCodigo: string;
      cantidad: number;
      /** Positivo: es una salida, como el retiro. */
      montoCentavos: number;
    };

export interface VistaTesoreria {
  desde: string;
  hasta: string;
  cuentas: CuentaEnVista[];
  total: {
    saldoInicioCentavos: number;
    saldoFinalCentavos: number;
    cuentasConSaldoInicio: number;
    cuentasConSaldoFinal: number;
    cuentas: number;
    entradasCentavos: number;
    salidasCentavos: number;
  };
  /** Cobranza del rango sin cuenta destino, de las sucursales en alcance. */
  sinCuenta: {
    sucursalCodigo: string;
    metodo: MetodoCobranza;
    montoCentavos: number;
  }[];
  /**
   * T-30/T-31: gastos de la ruta del rango cuya sucursal no tiene cuenta destino
   * de efectivo, de las sucursales en alcance. No restan de ninguna cuenta, pero
   * no se pierden: la vista los avisa como a la cobranza sin destino.
   */
  gastosSinCuenta: {
    sucursalCodigo: string;
    montoCentavos: number;
  }[];
  eventos: EventoTesoreria[];
}

export interface ExtrasVista {
  manuales?: MovimientoManual[];
  cobranza?: CobranzaDia[];
  destinos?: DestinoCobranza[];
  /** T-30/T-31: gastos de la ruta agrupados por dia y sucursal. */
  gastos?: GastoDia[];
  /** Codigos de sucursal cuya cobranza sin destino se reporta; null/ausente = todas. */
  sucursalesEnAlcance?: string[] | null;
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `AAAA-MM-DD` de un dia que existe (2026-02-30 no). */
export function esFechaValida(fecha: string): boolean {
  if (!RE_FECHA.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

/**
 * Saldo de una cuenta al inicio o al final del dia `fecha`:
 *   base       = el saldo fijado mas reciente con fecha <= `fecha`
 *   inicio     = base + movimientos en [base.fecha, fecha)
 *   final      = base + movimientos en [base.fecha, fecha]
 * Sin base -> `null` ("Sin saldo inicial"), nunca 0. El final NO es "el inicio
 * del dia siguiente": un saldo fijado manana no debe colarse en el cierre de hoy.
 */
export function saldoDeCuenta(
  cuentaId: string,
  fecha: string,
  momento: Momento,
  saldos: BaseSaldo[],
  movimientos: MovimientoSaldo[],
): number | null {
  let baseActual: BaseSaldo | null = null;
  for (const s of saldos) {
    if (s.cuentaId !== cuentaId || s.fecha > fecha) continue;
    if (baseActual === null || s.fecha > baseActual.fecha) baseActual = s;
  }
  if (baseActual === null) return null;

  let total = baseActual.montoCentavos;
  for (const m of movimientos) {
    if (m.cuentaId !== cuentaId || m.fecha < baseActual.fecha) continue;
    const dentro = momento === 'inicio' ? m.fecha < fecha : m.fecha <= fecha;
    if (dentro) total += m.montoCentavos;
  }
  return total;
}

/**
 * Convierte movimientos manuales, cobranza y gastos de la ruta en el arreglo que
 * `saldoDeCuenta` suma (spec §3.4 de T-28/T-29; D7 de T-30/T-31): deposito +,
 * retiro −, traspaso − en la de salida y + en la de entrada, cobranza + en la
 * cuenta destino vigente en su fecha, gasto de la ruta − en la cuenta destino
 * del EFECTIVO de su sucursal vigente en su fecha.
 */
export function movimientosDeSaldo(
  manuales: MovimientoManual[],
  cobranza: CobranzaDia[],
  destinos: DestinoCobranza[],
  gastos: GastoDia[] = [],
): {
  movimientos: MovimientoSaldo[];
  sinDestino: CobranzaDia[];
  gastosSinCuenta: GastoDia[];
} {
  const movimientos: MovimientoSaldo[] = [];
  for (const m of manuales) {
    if (m.tipo === 'deposito') {
      movimientos.push({
        cuentaId: m.cuentaId,
        fecha: m.fecha,
        montoCentavos: m.montoCentavos,
      });
    } else if (m.tipo === 'retiro') {
      movimientos.push({
        cuentaId: m.cuentaId,
        fecha: m.fecha,
        montoCentavos: -m.montoCentavos,
      });
    } else if (m.cuentaDestinoId !== null) {
      movimientos.push({
        cuentaId: m.cuentaId,
        fecha: m.fecha,
        montoCentavos: -m.montoCentavos,
      });
      movimientos.push({
        cuentaId: m.cuentaDestinoId,
        fecha: m.fecha,
        montoCentavos: m.montoCentavos,
      });
    }
  }
  const sinDestino: CobranzaDia[] = [];
  for (const c of cobranza) {
    const d = destinoDe(c.sucursalId, c.metodo, c.fecha, destinos);
    if (d === null) sinDestino.push(c);
    else
      movimientos.push({
        cuentaId: d.cuentaId,
        fecha: c.fecha,
        montoCentavos: c.montoCentavos,
      });
  }
  const gastosSinCuenta: GastoDia[] = [];
  for (const g of gastos) {
    // "Efectivo cobranza del dia": la misma cuenta que recibe el efectivo.
    const d = destinoDe(g.sucursalId, 'efectivo', g.fecha, destinos);
    if (d === null) gastosSinCuenta.push(g);
    else
      movimientos.push({
        cuentaId: d.cuentaId,
        fecha: g.fecha,
        montoCentavos: -g.montoCentavos,
      });
  }
  return { movimientos, sinDestino, gastosSinCuenta };
}

/** El saldo fijado mas reciente con fecha <= `fecha` (la base del calculo), o null. */
function baseDe(
  cuentaId: string,
  fecha: string,
  saldos: BaseSaldo[],
): BaseSaldo | null {
  let base: BaseSaldo | null = null;
  for (const s of saldos) {
    if (s.cuentaId !== cuentaId || s.fecha > fecha) continue;
    if (base === null || s.fecha > base.fecha) base = s;
  }
  return base;
}

/** Generales primero; luego por codigo de sucursal y nombre (sin mayusculas). */
export function ordenarCuentas<
  T extends { nombre: string; sucursalCodigo: string | null },
>(cuentas: T[]): T[] {
  return [...cuentas].sort((a, b) => {
    if (a.sucursalCodigo !== b.sucursalCodigo) {
      if (a.sucursalCodigo === null) return -1;
      if (b.sucursalCodigo === null) return 1;
      return a.sucursalCodigo.localeCompare(b.sucursalCodigo);
    }
    return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
  });
}

/**
 * La vista de `GET /tesoreria`. `saldos` son los fijados vivos de las cuentas en
 * alcance con fecha <= `hasta`; `extras` trae los movimientos manuales, la
 * cobranza agrupada y los destinos (T-29). Sin `extras` se comporta como T-28.
 */
export function armarVista(
  desde: string,
  hasta: string,
  cuentas: CuentaEnAlcance[],
  saldos: SaldoFijado[],
  extras: ExtrasVista = {},
): VistaTesoreria {
  const manuales = extras.manuales ?? [];
  const cobranza = extras.cobranza ?? [];
  const destinos = extras.destinos ?? [];
  const gastos = extras.gastos ?? [];
  const { movimientos, sinDestino, gastosSinCuenta } = movimientosDeSaldo(
    manuales,
    cobranza,
    destinos,
    gastos,
  );

  const filas: CuentaEnVista[] = ordenarCuentas(cuentas).map((c) => {
    const baseFinal = baseDe(c.id, hasta, saldos);
    const corte =
      baseFinal && baseFinal.fecha > desde ? baseFinal.fecha : desde;
    let entradas = 0;
    let salidas = 0;
    for (const m of movimientos) {
      if (m.cuentaId !== c.id || m.fecha < corte || m.fecha > hasta) continue;
      if (m.montoCentavos >= 0) entradas += m.montoCentavos;
      else salidas += -m.montoCentavos;
    }
    return {
      id: c.id,
      nombre: c.nombre,
      sucursalCodigo: c.sucursalCodigo,
      saldoInicioCentavos: saldoDeCuenta(
        c.id,
        desde,
        'inicio',
        saldos,
        movimientos,
      ),
      saldoFinalCentavos: saldoDeCuenta(
        c.id,
        hasta,
        'final',
        saldos,
        movimientos,
      ),
      entradasCentavos: entradas,
      salidasCentavos: salidas,
      saldoFijadoEnRango:
        baseFinal && baseFinal.fecha > desde ? baseFinal.fecha : null,
    };
  });

  const total = {
    saldoInicioCentavos: 0,
    saldoFinalCentavos: 0,
    cuentasConSaldoInicio: 0,
    cuentasConSaldoFinal: 0,
    cuentas: filas.length,
    entradasCentavos: 0,
    salidasCentavos: 0,
  };
  for (const f of filas) {
    if (f.saldoInicioCentavos !== null) {
      total.saldoInicioCentavos += f.saldoInicioCentavos;
      total.cuentasConSaldoInicio += 1;
    }
    if (f.saldoFinalCentavos !== null) {
      total.saldoFinalCentavos += f.saldoFinalCentavos;
      total.cuentasConSaldoFinal += 1;
    }
    total.entradasCentavos += f.entradasCentavos;
    total.salidasCentavos += f.salidasCentavos;
  }

  const enRango = (fecha: string) => fecha >= desde && fecha <= hasta;
  const visibles = new Set(cuentas.map((c) => c.id));

  const sinCuentaMapa = new Map<
    string,
    { sucursalCodigo: string; metodo: MetodoCobranza; montoCentavos: number }
  >();
  for (const c of sinDestino) {
    if (!enRango(c.fecha)) continue;
    if (
      extras.sucursalesEnAlcance &&
      !extras.sucursalesEnAlcance.includes(c.sucursalCodigo)
    )
      continue;
    const clave = `${c.sucursalCodigo}:${c.metodo}`;
    const actual = sinCuentaMapa.get(clave) ?? {
      sucursalCodigo: c.sucursalCodigo,
      metodo: c.metodo,
      montoCentavos: 0,
    };
    actual.montoCentavos += c.montoCentavos;
    sinCuentaMapa.set(clave, actual);
  }
  const sinCuenta = [...sinCuentaMapa.values()].sort(
    (a, b) =>
      a.sucursalCodigo.localeCompare(b.sucursalCodigo) ||
      a.metodo.localeCompare(b.metodo),
  );

  const gastosSinCuentaMapa = new Map<
    string,
    { sucursalCodigo: string; montoCentavos: number }
  >();
  for (const g of gastosSinCuenta) {
    if (!enRango(g.fecha)) continue;
    if (
      extras.sucursalesEnAlcance &&
      !extras.sucursalesEnAlcance.includes(g.sucursalCodigo)
    )
      continue;
    const actual = gastosSinCuentaMapa.get(g.sucursalCodigo) ?? {
      sucursalCodigo: g.sucursalCodigo,
      montoCentavos: 0,
    };
    actual.montoCentavos += g.montoCentavos;
    gastosSinCuentaMapa.set(g.sucursalCodigo, actual);
  }
  const gastosSinCuentaVista = [...gastosSinCuentaMapa.values()].sort((a, b) =>
    a.sucursalCodigo.localeCompare(b.sucursalCodigo),
  );

  const eventos: EventoTesoreria[] = [];
  for (const s of saldos) {
    if (!enRango(s.fecha)) continue;
    eventos.push({
      tipo: 'saldo-fijado',
      id: s.id,
      fecha: s.fecha,
      cuentaId: s.cuentaId,
      cuentaNombre: s.cuentaNombre,
      montoCentavos: s.montoCentavos,
      comentario: s.comentario,
      capturo: s.capturo,
    });
  }
  for (const m of manuales) {
    if (!enRango(m.fecha)) continue;
    // Un traspaso se ve si cualquiera de sus dos cuentas esta en alcance (spec §4.2).
    if (
      !visibles.has(m.cuentaId) &&
      !(m.cuentaDestinoId && visibles.has(m.cuentaDestinoId))
    )
      continue;
    if (
      m.tipo === 'traspaso' &&
      m.cuentaDestinoId !== null &&
      m.cuentaDestinoNombre !== null
    ) {
      eventos.push({
        tipo: 'traspaso',
        id: m.id,
        fecha: m.fecha,
        cuentaId: m.cuentaId,
        cuentaNombre: m.cuentaNombre,
        cuentaDestinoId: m.cuentaDestinoId,
        cuentaDestinoNombre: m.cuentaDestinoNombre,
        montoCentavos: m.montoCentavos,
        comentario: m.comentario,
        capturo: m.capturo,
      });
    } else if (m.tipo === 'deposito' || m.tipo === 'retiro') {
      eventos.push({
        tipo: m.tipo,
        id: m.id,
        fecha: m.fecha,
        cuentaId: m.cuentaId,
        cuentaNombre: m.cuentaNombre,
        montoCentavos: m.montoCentavos,
        comentario: m.comentario,
        capturo: m.capturo,
      });
    }
  }
  for (const c of cobranza) {
    if (!enRango(c.fecha)) continue;
    const d = destinoDe(c.sucursalId, c.metodo, c.fecha, destinos);
    if (d === null || !visibles.has(d.cuentaId)) continue;
    eventos.push({
      tipo: 'cobranza',
      id: `cobranza:${c.fecha}:${d.cuentaId}:${c.sucursalId}:${c.metodo}`,
      fecha: c.fecha,
      cuentaId: d.cuentaId,
      cuentaNombre: d.cuentaNombre,
      sucursalCodigo: c.sucursalCodigo,
      metodo: c.metodo,
      cantidad: c.cantidad,
      montoCentavos: c.montoCentavos,
    });
  }
  for (const g of gastos) {
    if (!enRango(g.fecha)) continue;
    const d = destinoDe(g.sucursalId, 'efectivo', g.fecha, destinos);
    if (d === null || !visibles.has(d.cuentaId)) continue;
    eventos.push({
      tipo: 'gasto-ruta',
      id: `gasto-ruta:${g.fecha}:${d.cuentaId}:${g.sucursalId}`,
      fecha: g.fecha,
      cuentaId: d.cuentaId,
      cuentaNombre: d.cuentaNombre,
      sucursalCodigo: g.sucursalCodigo,
      cantidad: g.cantidad,
      montoCentavos: g.montoCentavos,
    });
  }
  eventos.sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      a.cuentaNombre.localeCompare(b.cuentaNombre, 'es', {
        sensitivity: 'base',
      }) ||
      a.id.localeCompare(b.id),
  );

  return {
    desde,
    hasta,
    cuentas: filas,
    total,
    sinCuenta,
    gastosSinCuenta: gastosSinCuentaVista,
    eventos,
  };
}

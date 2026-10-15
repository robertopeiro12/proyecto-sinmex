/**
 * T-28 — el calculo del saldo de Tesoreria, en UN solo lugar.
 *
 * Un saldo fijado es el saldo real de una cuenta al INICIO de su dia (spec §3.3):
 * el primero es el saldo inicial y los siguientes son "modificar saldo", un nuevo
 * punto de partida. T-28 no tiene movimientos; T-29 alimentara `movimientos`
 * (depositos, retiros, traspasos, cobranza) sin cambiar esta firma.
 *
 * Todo en centavos enteros: nunca flotantes (ver sincronizacion/dinero.ts).
 */

/** ±999,999,999,999.99: lo que cabe en `numeric(14,2)`. */
export const MAX_CENTAVOS_TESORERIA = 99_999_999_999_999;

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
}

export interface EventoTesoreria {
  /** T-29 agregara 'deposito', 'retiro', 'traspaso'… sin cambiar la forma. */
  tipo: 'saldo-fijado';
  id: string;
  fecha: string;
  cuentaId: string;
  cuentaNombre: string;
  montoCentavos: number;
  comentario: string | null;
  capturo: string;
}

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
  };
  eventos: EventoTesoreria[];
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
 * alcance con fecha <= `hasta` (el repositorio ya filtro).
 */
export function armarVista(
  desde: string,
  hasta: string,
  cuentas: CuentaEnAlcance[],
  saldos: SaldoFijado[],
): VistaTesoreria {
  const movimientos: MovimientoSaldo[] = [];
  const filas: CuentaEnVista[] = ordenarCuentas(cuentas).map((c) => ({
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
  }));

  const total = {
    saldoInicioCentavos: 0,
    saldoFinalCentavos: 0,
    cuentasConSaldoInicio: 0,
    cuentasConSaldoFinal: 0,
    cuentas: filas.length,
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
  }

  const eventos: EventoTesoreria[] = saldos
    .filter((s) => s.fecha >= desde && s.fecha <= hasta)
    .sort(
      (a, b) =>
        a.fecha.localeCompare(b.fecha) ||
        a.cuentaNombre.localeCompare(b.cuentaNombre, 'es', {
          sensitivity: 'base',
        }),
    )
    .map((s) => ({
      tipo: 'saldo-fijado',
      id: s.id,
      fecha: s.fecha,
      cuentaId: s.cuentaId,
      cuentaNombre: s.cuentaNombre,
      montoCentavos: s.montoCentavos,
      comentario: s.comentario,
      capturo: s.capturo,
    }));

  return { desde, hasta, cuentas: filas, total, eventos };
}

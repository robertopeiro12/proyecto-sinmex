import { apiFetch } from "./api";
import { textoMonto } from "./cobranzas";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
import { formatearFecha } from "./reportes";
import { formatearPesos } from "./ventas";

// Copia de las formas de apps/backend/src/modules/tesoreria/ (reglas-saldo.ts y
// tesoreria.service.ts): el portal no puede importar del backend. Dinero en
// centavos enteros, con signo.

export const MAX_CENTAVOS_TESORERIA = 99_999_999_999_999;

export interface CuentaTesoreria {
  id: string;
  nombre: string;
  /** `null` = cuenta general (de toda la empresa). */
  sucursalId: string | null;
  sucursalCodigo: string | null;
}

export interface SaldoFijado {
  id: string;
  cuentaId: string;
  cuentaNombre: string;
  sucursalCodigo: string | null;
  fecha: string;
  montoCentavos: number;
  comentario: string | null;
  capturo: string;
}

export interface FilaSaldoDelDia {
  cuentaId: string;
  nombre: string;
  sucursalCodigo: string | null;
  saldo: { id: string; montoCentavos: number; comentario: string | null } | null;
}

export interface SaldosDelDia {
  fecha: string;
  cuentas: FilaSaldoDelDia[];
  saldos: SaldoFijado[];
}

export type MetodoCobranza = "efectivo" | "transferencia" | "cheque";
export type TipoMovimiento = "deposito" | "retiro" | "traspaso";

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
  /** El usuario ve las dos cuentas: puede corregirlo o eliminarlo. */
  editable: boolean;
}

export interface DestinoCobranza {
  id: string;
  sucursalId: string;
  sucursalCodigo: string;
  metodo: MetodoCobranza;
  cuentaId: string;
  cuentaNombre: string;
  /** `AAAA-MM-DD`. */
  desde: string;
}

export interface DestinosSucursal {
  sucursalId: string;
  sucursalCodigo: string;
  sucursalNombre: string;
  vigentes: Record<MetodoCobranza, DestinoCobranza | null>;
  historial: DestinoCobranza[];
}

export type EventoTesoreria =
  | {
      tipo: "saldo-fijado";
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      montoCentavos: number;
      comentario: string | null;
      capturo: string;
    }
  | {
      tipo: "deposito" | "retiro";
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      montoCentavos: number;
      comentario: string | null;
      capturo: string;
    }
  | {
      tipo: "traspaso";
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
      tipo: "cobranza";
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
      // T-30/T-31 (D7): el total de gastos de la ruta de una sucursal en un día. Monto positivo: es salida.
      tipo: "gasto-ruta";
      id: string;
      fecha: string;
      cuentaId: string;
      cuentaNombre: string;
      sucursalCodigo: string;
      cantidad: number;
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
  sinCuenta: { sucursalCodigo: string; metodo: MetodoCobranza; montoCentavos: number }[];
  /** T-30/T-31: gastos de la ruta del rango cuya sucursal no tiene cuenta destino de efectivo. */
  gastosSinCuenta: { sucursalCodigo: string; montoCentavos: number }[];
  eventos: EventoTesoreria[];
}

function query(params: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const texto = p.toString();
  return texto ? `?${texto}` : "";
}

export function listarCuentasTesoreria(sucursal?: string | null): Promise<CuentaTesoreria[]> {
  return apiFetch<CuentaTesoreria[]>(`/tesoreria/cuentas${query({ sucursal })}`);
}

export function crearCuentaTesoreria(datos: { nombre: string; sucursalId?: string }): Promise<CuentaTesoreria> {
  return apiFetch<CuentaTesoreria>("/tesoreria/cuentas", { method: "POST", body: JSON.stringify(datos) });
}

export function renombrarCuentaTesoreria(id: string, nombre: string): Promise<CuentaTesoreria> {
  return apiFetch<CuentaTesoreria>(`/tesoreria/cuentas/${id}`, { method: "PATCH", body: JSON.stringify({ nombre }) });
}

export function eliminarCuentaTesoreria(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/tesoreria/cuentas/${id}`, { method: "DELETE" });
}

export function obtenerSaldosDelDia(p: { fecha: string; sucursal?: string | null }): Promise<SaldosDelDia> {
  return apiFetch<SaldosDelDia>(`/tesoreria/saldos${query({ fecha: p.fecha, sucursal: p.sucursal })}`);
}

export function guardarSaldos(datos: {
  fecha: string;
  saldos: { cuentaId: string; montoCentavos: number; comentario?: string }[];
}): Promise<{ guardados: number }> {
  return apiFetch<{ guardados: number }>("/tesoreria/saldos", { method: "PUT", body: JSON.stringify(datos) });
}

export function eliminarSaldoFijado(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/tesoreria/saldos/${id}`, { method: "DELETE" });
}

export function obtenerTesoreria(p: { desde: string; hasta: string; sucursal?: string | null }): Promise<VistaTesoreria> {
  return apiFetch<VistaTesoreria>(`/tesoreria${query({ desde: p.desde, hasta: p.hasta, sucursal: p.sucursal })}`);
}

export function listarMovimientos(p: { desde: string; hasta: string; sucursal?: string | null }): Promise<MovimientoManual[]> {
  return apiFetch<MovimientoManual[]>(`/tesoreria/movimientos${query({ desde: p.desde, hasta: p.hasta, sucursal: p.sucursal })}`);
}

export function crearMovimiento(d: {
  tipo: TipoMovimiento;
  fecha: string;
  montoCentavos: number;
  cuentaId: string;
  cuentaDestinoId?: string;
  comentario?: string;
}): Promise<MovimientoManual> {
  return apiFetch<MovimientoManual>("/tesoreria/movimientos", { method: "POST", body: JSON.stringify(d) });
}

export function editarMovimiento(
  id: string,
  d: { fecha?: string; montoCentavos?: number; cuentaId?: string; cuentaDestinoId?: string; comentario?: string },
): Promise<MovimientoManual> {
  return apiFetch<MovimientoManual>(`/tesoreria/movimientos/${id}`, { method: "PATCH", body: JSON.stringify(d) });
}

export function eliminarMovimiento(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/tesoreria/movimientos/${id}`, { method: "DELETE" });
}

export function obtenerDestinos(sucursal?: string | null): Promise<DestinosSucursal[]> {
  return apiFetch<DestinosSucursal[]>(`/tesoreria/destinos${query({ sucursal })}`);
}

export function guardarDestino(d: { sucursalId: string; metodo: MetodoCobranza; cuentaId: string; desde: string }): Promise<DestinoCobranza> {
  return apiFetch<DestinoCobranza>("/tesoreria/destinos", { method: "PUT", body: JSON.stringify(d) });
}

export const ETIQUETA_METODO: Record<MetodoCobranza, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
};

export const ETIQUETA_TIPO: Record<TipoMovimiento, string> = {
  deposito: "Depósito",
  retiro: "Retiro",
  traspaso: "Traspaso",
};

/** Concepto y cuenta para la lista y el Excel; `signo`: 1 entra, −1 sale, 0 neutro (traspaso, saldo fijado). */
export function describirEvento(e: EventoTesoreria): { concepto: string; cuenta: string; signo: 1 | -1 | 0 } {
  switch (e.tipo) {
    case "deposito":
      return { concepto: "Depósito", cuenta: e.cuentaNombre, signo: 1 };
    case "retiro":
      return { concepto: "Retiro", cuenta: e.cuentaNombre, signo: -1 };
    case "traspaso":
      return { concepto: "Traspaso", cuenta: `${e.cuentaNombre} → ${e.cuentaDestinoNombre}`, signo: 0 };
    case "cobranza":
      return {
        concepto: `Cobranza en ${ETIQUETA_METODO[e.metodo].toLowerCase()} · ${e.cantidad} ${e.cantidad === 1 ? "cobro" : "cobros"} · ${e.sucursalCodigo}`,
        cuenta: e.cuentaNombre,
        signo: 1,
      };
    case "gasto-ruta":
      return {
        concepto: `Gastos de ruta · ${e.cantidad} ${e.cantidad === 1 ? "gasto" : "gastos"} · ${e.sucursalCodigo}`,
        cuenta: e.cuentaNombre,
        signo: -1,
      };
    default:
      return { concepto: "Saldo fijado", cuenta: e.cuentaNombre, signo: 0 };
  }
}

export function primerDiaDelMesDe(fecha: string): string {
  return `${fecha.slice(0, 8)}01`;
}

export function etiquetaSucursalCuenta(codigo: string | null): string {
  return codigo ?? "General";
}

/**
 * Monto tecleado -> centavos con signo, sin coma flotante. Acepta `$`, comas de
 * miles bien puestas y el `-` al frente (antes o despues del `$`). Vacio o mal
 * escrito -> `null`. Mismo criterio que `leerMontoCentavos` (lib/cobranzas.ts),
 * que no admite negativos ni el 0.
 */
export function leerMontoConSignoCentavos(texto: string): number | null {
  let limpio = texto.trim();
  let negativo = false;
  if (limpio.startsWith("-")) {
    negativo = true;
    limpio = limpio.slice(1).trim();
  }
  if (limpio.startsWith("$")) limpio = limpio.slice(1).trim();
  if (!negativo && limpio.startsWith("-")) {
    negativo = true;
    limpio = limpio.slice(1).trim();
  }
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(limpio)) return null;
  const [enteros, decimales = ""] = limpio.replace(/,/g, "").split(".");
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
  if (!Number.isSafeInteger(centavos) || centavos > MAX_CENTAVOS_TESORERIA) return null;
  return negativo && centavos > 0 ? -centavos : centavos;
}

/** Centavos al texto del campo (`"-1500.50"`). */
export function textoMontoConSigno(centavos: number): string {
  return centavos < 0 ? `-${textoMonto(-centavos)}` : textoMonto(centavos);
}

/** El dia anterior a `AAAA-MM-DD` (para el atajo "Ayer"). */
export function diaAnterior(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const pesos = (centavos: number | null): string | number =>
  centavos === null ? "Sin saldo inicial" : centavos / 100;

/**
 * Una hoja (la utilidad de T-15 arma una sola): cuentas con entradas y salidas,
 * Total Tesoreria, la cobranza sin cuenta y los movimientos del rango, todo
 * reutilizando las mismas columnas.
 */
export function definicionExcelTesoreria(vista: VistaTesoreria, filtros: { sucursal: string }): DefinicionExcel {
  const filas: FilaExcel[] = vista.cuentas.map((c) => ({
    celdas: [
      c.nombre,
      etiquetaSucursalCuenta(c.sucursalCodigo),
      pesos(c.saldoInicioCentavos),
      c.entradasCentavos / 100,
      c.salidasCentavos / 100,
      pesos(c.saldoFinalCentavos),
      c.saldoFijadoEnRango ? `Saldo fijado el ${formatearFecha(c.saldoFijadoEnRango)}` : null,
    ],
  }));
  const t = vista.total;
  const conSaldo =
    t.cuentasConSaldoInicio === t.cuentas && t.cuentasConSaldoFinal === t.cuentas
      ? `${t.cuentas} cuentas`
      : t.cuentasConSaldoInicio === t.cuentasConSaldoFinal
        ? `${t.cuentasConSaldoFinal} de ${t.cuentas} con saldo`
        : `Inicio: ${t.cuentasConSaldoInicio} de ${t.cuentas} · final: ${t.cuentasConSaldoFinal} de ${t.cuentas} con saldo`;
  filas.push({
    celdas: ["Total Tesorería", conSaldo, t.saldoInicioCentavos / 100, t.entradasCentavos / 100, t.salidasCentavos / 100, t.saldoFinalCentavos / 100, null],
    tipo: "total",
  });
  if (vista.sinCuenta.length > 0) {
    filas.push({ celdas: ["Cobranza sin cuenta asignada", null, null, null, null, null, null], tipo: "grupo" });
    for (const s of vista.sinCuenta) {
      filas.push({ celdas: [`${s.sucursalCodigo} · ${ETIQUETA_METODO[s.metodo]}`, null, null, null, null, null, `${formatearPesos(s.montoCentavos)} sin cuenta asignada`] });
    }
  }
  if (vista.gastosSinCuenta.length > 0) {
    filas.push({ celdas: ["Gastos de ruta sin cuenta de efectivo", null, null, null, null, null, null], tipo: "grupo" });
    for (const g of vista.gastosSinCuenta) {
      filas.push({ celdas: [g.sucursalCodigo, null, null, null, null, null, `${formatearPesos(g.montoCentavos)} sin cuenta de efectivo`] });
    }
  }
  if (vista.eventos.length > 0) {
    filas.push({ celdas: ["Movimientos del rango", "Fecha", "Concepto", "Entra", "Sale", null, "Comentario"], tipo: "grupo" });
    for (const e of vista.eventos) {
      const { concepto, cuenta, signo } = describirEvento(e);
      const monto = e.montoCentavos / 100;
      const comentario =
        e.tipo === "cobranza" || e.tipo === "gasto-ruta"
          ? null
          : e.comentario
            ? `${e.comentario} · Capturó: ${e.capturo}`
            : `Capturó: ${e.capturo}`;
      filas.push({
        celdas: [
          cuenta,
          formatearFecha(e.fecha),
          concepto,
          signo === 1 ? monto : null,
          signo === -1 || e.tipo === "traspaso" ? monto : null,
          e.tipo === "saldo-fijado" ? monto : null,
          comentario,
        ],
      });
    }
  }
  return {
    titulo: "Tesorería",
    filtros: [
      ["Rango", `${formatearFecha(vista.desde)} a ${formatearFecha(vista.hasta)}`],
      ["Sucursal", filtros.sucursal],
    ],
    columnas: [
      { encabezado: "Cuenta", tipo: "texto", ancho: 32 },
      { encabezado: "Sucursal", tipo: "texto", ancho: 14 },
      { encabezado: "Saldo al inicio", tipo: "pesos", ancho: 18 },
      { encabezado: "Entradas", tipo: "pesos", ancho: 16 },
      { encabezado: "Salidas", tipo: "pesos", ancho: 16 },
      { encabezado: "Saldo al final", tipo: "pesos", ancho: 18 },
      { encabezado: "Comentario", tipo: "texto", ancho: 40 },
    ],
    filas,
    nombreArchivo: `tesoreria-${vista.desde}-a-${vista.hasta}`,
  };
}

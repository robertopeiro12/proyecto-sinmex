import { apiFetch } from "./api";
import { textoMonto } from "./cobranzas";
import type { DefinicionExcel, FilaExcel } from "./excel/definicion";
import { formatearFecha } from "./reportes";

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

export interface CuentaEnVista {
  id: string;
  nombre: string;
  sucursalCodigo: string | null;
  saldoInicioCentavos: number | null;
  saldoFinalCentavos: number | null;
}

export interface EventoTesoreria {
  tipo: "saldo-fijado";
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
 * Una hoja (la utilidad de T-15 arma una sola): cuentas, Total Tesoreria y, si
 * hay, el bloque "Saldos fijados en el rango" reutilizando las columnas.
 */
export function definicionExcelTesoreria(
  vista: VistaTesoreria,
  filtros: { sucursal: string },
): DefinicionExcel {
  const filas: FilaExcel[] = vista.cuentas.map((c) => ({
    celdas: [c.nombre, etiquetaSucursalCuenta(c.sucursalCodigo), pesos(c.saldoInicioCentavos), pesos(c.saldoFinalCentavos), null],
  }));
  const t = vista.total;
  const conSaldo =
    t.cuentasConSaldoInicio === t.cuentas && t.cuentasConSaldoFinal === t.cuentas
      ? `${t.cuentas} cuentas`
      : t.cuentasConSaldoInicio === t.cuentasConSaldoFinal
        ? `${t.cuentasConSaldoFinal} de ${t.cuentas} con saldo`
        : `Inicio: ${t.cuentasConSaldoInicio} de ${t.cuentas} · final: ${t.cuentasConSaldoFinal} de ${t.cuentas} con saldo`;
  filas.push({
    celdas: ["Total Tesorería", conSaldo, t.saldoInicioCentavos / 100, t.saldoFinalCentavos / 100, null],
    tipo: "total",
  });
  if (vista.eventos.length > 0) {
    filas.push({ celdas: ["Saldos fijados en el rango", "Fecha", null, "Monto", "Comentario"], tipo: "grupo" });
    for (const e of vista.eventos) {
      const comentario = e.comentario ? `${e.comentario} · Capturó: ${e.capturo}` : `Capturó: ${e.capturo}`;
      filas.push({ celdas: [e.cuentaNombre, formatearFecha(e.fecha), null, e.montoCentavos / 100, comentario] });
    }
  }
  return {
    titulo: "Tesorería",
    filtros: [
      ["Rango", `${formatearFecha(vista.desde)} a ${formatearFecha(vista.hasta)}`],
      ["Sucursal", filtros.sucursal],
    ],
    columnas: [
      { encabezado: "Cuenta", tipo: "texto", ancho: 30 },
      { encabezado: "Sucursal", tipo: "texto", ancho: 18 },
      { encabezado: "Saldo al inicio", tipo: "pesos", ancho: 18 },
      { encabezado: "Saldo al final", tipo: "pesos", ancho: 18 },
      { encabezado: "Comentario", tipo: "texto", ancho: 40 },
    ],
    filas,
    nombreArchivo: `tesoreria-${vista.desde}-a-${vista.hasta}`,
  };
}
